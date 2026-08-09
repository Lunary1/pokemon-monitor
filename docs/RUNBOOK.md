# Runbook

The reference to follow at 2am when something's broken. Companion to `docs/SDLC.md` §9 (Observability and Operations) — that doc defines *what* to watch and the high-level incident response loop (detect → triage → contain → fix → verify → log); this doc is the concrete "I'm looking at X, now what" reference for the four things that can silently fail: **worker, API/dashboard, database, notification path**.

> **Status note:** `/api/health` is implemented as described below (#12), and the dashboard **log viewer at `/logs`** is live (#36) — filter by source and level there rather than querying the table by hand. `ErrorLog` writes are **partial**: notification dispatch failures write rows (`source: notification`), but adapter and worker error paths do not yet, so an instruction below to check `ErrorLog` for `source: adapter:<key>` still means falling back to Railway service logs and `docker compose logs` locally. Tracked in `docs/RISK_REGISTER.md`.

## Reading `/api/health`

Shape (plan §14 "Health Checks", plan §11 "System" API):

```json
{
  "worker": "running",
  "db": "ok",
  "lastCheck": "2026-08-05T14:32:00.000Z",
  "stale": false
}
```

| Field | Healthy value | What it means |
|---|---|---|
| `worker` | `"running"` | The monitor worker is keeping up. Reported as `"degraded"` whenever `stale` is true |
| `db` | `"ok"` | The web process can reach PostgreSQL |
| `lastCheck` | A recent ISO timestamp | The most recent `StockCheck` across enabled products in enabled stores. `null` when no check has ever run |
| `stale` | `false` | Whether `lastCheck` has fallen outside the staleness threshold below |

**Staleness rule** (`docs/SDLC.md` §9): `lastCheck` is **stale** if it is older than **2x the shortest `pollingInterval` among currently enabled `Store` rows**. This is computed by the endpoint itself — `stale` is the field to watch, not something to work out by hand at 2am.

Two cases deliberately report `stale: false` rather than alerting, so a quiet signal stays trustworthy:

- **`lastCheck: null`** — no check has ever run. A fresh deploy hasn't fallen behind, it hasn't started. Alerting here would fire on every clean deploy.
- **No enabled stores** — nothing is scheduled, so there is no cadence to be behind.

**The endpoint returns HTTP 200 whenever the `web` process is serving**, including when `stale: true` or `db: "error"`. That is deliberate: a non-200 means "the web service itself is down", which is a different incident with a different fix than "the worker is behind" or "Postgres is unreachable" (see the failure table below). **So a 200 alone tells you nothing — you must match on the body.**

### Configuring the UptimeRobot check

Ping `/api/health` every 5 minutes and alert via a channel independent of this app's own Discord webhook — a fully-down app can't alert you through itself.

Because the endpoint returns 200 in every state, a plain HTTP(s) monitor only catches a fully-down `web` service. Add two **Keyword** monitors alongside it:

| Monitor type | Setting | Catches |
|---|---|---|
| HTTP(s) | URL `https://<host>/api/health` | `web` service down or unreachable |
| Keyword | Keyword `"stale":true`, alert **when keyword exists** | Worker crashed, stuck, or crash-looping |
| Keyword | Keyword `"db":"ok"`, alert **when keyword does not exist** | Postgres unreachable |

Keyword matching is on the raw response body, so match the exact JSON with no spaces around the colon.

> The `"db":"ok"` monitor is phrased as *absence* on purpose. Matching for `"db":"error"` would go silent if the response shape ever changed, and a monitor that fails open is worse than none — it reports healthy precisely when it has stopped understanding the response.

## Reading the log viewer (`/logs`)

The dashboard page at `/logs` lists `ErrorLog` newest-first, filterable by level (`INFO`/`WARN`/`ERROR`) and by source. Each row shows its `context` JSON inline and its stack trace behind a collapsible toggle. The same data is available as JSON at `GET /api/logs?source=&level=&page=` if you'd rather grep it.

### Purging old logs

The viewer is **read-only** — there is deliberately no purge button, because the dashboard is unauthenticated (auth is excluded per plan §1) and this deletion is irreversible. Purge from a shell instead:

```bash
curl -X DELETE "https://<host>/api/logs?olderThanDays=30"
# → {"deleted":128,"cutoff":"2026-07-10T12:00:00.000Z"}
```

`olderThanDays` is required and must be positive — a bare `DELETE /api/logs` returns 400 and deletes nothing, so a mistyped command can't wipe the table. Check the returned `cutoff` before assuming the right window was applied.

> This purges `ErrorLog` only. `StockCheck` retention is a separate, currently unimplemented concern (#95).

## Common failure signatures

| Signature | Likely cause | Fix |
|---|---|---|
| `/api/health` returns `db: "error"` (or the endpoint 500s) | Postgres unreachable — wrong/rotated `DATABASE_URL`, DB service down or out of connections | Check `DATABASE_URL` in the Railway `web` and `worker` service env vars matches the live Postgres instance; check Railway Postgres plugin status page; check for a connection-limit exhaustion (too many idle Prisma clients) |
| `/api/health` `db: "ok"`, but `lastCheck` is stale beyond 2x the shortest polling interval | Worker process crashed, is stuck, or is in a crash-restart loop | Check the `worker` service logs on Railway for a stack trace or repeated restarts; if it's crash-looping, roll back to the last known-good worker image (see Rollback below) before debugging further |
| `/api/health` unreachable entirely (connection refused / timeout) | `web` service itself is down, not just the health check | Check Railway `web` service status/logs; check for a bad deploy (see Rollback below) |
| Restocks appear in `StockEvent` / dashboard but no Discord message arrives | Notification path broken between event and delivery | Check `Notification.status` for the relevant row — `FAILED` means the webhook rejected the send (check `Notification.error`); a pile of `PENDING` rows means the notification dispatcher itself isn't running or is stuck; use `POST /api/notifications/test` to send a probe message and confirm the webhook itself still works (also catches a revoked/deleted Discord webhook) |
| One adapter's products all show `inStock: false` and never flip | Store changed HTML/selectors, or the adapter is being blocked (429/CAPTCHA/IP ban) | Check `ErrorLog` filtered to `source: adapter:<key>` for parse errors or non-200 responses; manually fetch the product URL to see if the page layout changed; per `docs/SDLC.md` §7 (Phase 7 gate), an adapter breaking 2+ times in 30 days needs a design review toward a more stable data source (JSON endpoint) rather than another selector patch |
| Notification storm — many restock messages in a short window, most look like false positives | A flapping product (rapid in-stock/out-of-stock oscillation) is defeating debounce, or debounce isn't implemented for that path | Immediate containment: set `Setting.notificationsEnabled = false` (direct DB update or settings UI) to stop the bleeding; then diagnose the specific product's `StockCheck` history for the flap pattern before re-enabling |
| Red "Notifications are failing" banner across the top of the dashboard | The last 3 consecutive Discord delivery attempts failed — most often a revoked or deleted webhook | See "Dead Discord webhook" below |

## Dead Discord webhook

The notification channel is a single point of failure: the same Discord webhook carries both restock alerts and (per `docs/SDLC.md` §9) ops alerts. When it breaks, an alert sent *through* it cannot arrive — so detection has to come from somewhere else.

### Detecting it

Three independent signals, in order of how likely you are to notice:

1. **The dashboard banner.** Shown on every dashboard page when the 3 most recent delivery attempts all failed. The dashboard is reachable independently of Discord, which is the point — this is the signal that still works when the channel itself is down. `SKIPPED` rows (cooldown, dedup, notifications disabled) are excluded, so a quiet period never fakes or masks an outage.
2. **`ErrorLog` rows with `source: notification`.** Every failed dispatch writes one, with the transport error in `message` and `{ eventId, productId, channel }` in `context`.
3. **`Notification` rows with `status = FAILED`.** The per-attempt record, with the raw error in `Notification.error`.

```sql
-- Recent notification failures, newest first
SELECT "occurredAt", message, context
FROM "ErrorLog"
WHERE source = 'notification'
ORDER BY "occurredAt" DESC
LIMIT 20;

-- Delivery attempts (ignoring skips), to confirm it's persistent rather than one blip
SELECT "createdAt", status, error
FROM "Notification"
WHERE status IN ('SENT', 'FAILED')
ORDER BY "createdAt" DESC
LIMIT 10;
```

### Recovering

1. **Confirm the webhook is the problem.** A `401`/`404` in `Notification.error` means the webhook was revoked or deleted on Discord's side. A `429` is rate limiting — that resolves on its own; don't regenerate the webhook for it. A connection/timeout error points at network or a Discord outage rather than your configuration.
2. **Regenerate it in Discord:** Server Settings → Integrations → Webhooks → pick or create the webhook → Copy Webhook URL.
3. **Update it in the app:** paste the new URL into the dashboard's Settings page (`/settings`). That writes `Setting.discordWebhookUrl`, which takes precedence over the `DISCORD_WEBHOOK_URL` env var — so updating the env var alone will *not* take effect while a value is set in Settings.
4. **Verify.** Trigger a real delivery rather than waiting for a natural restock: open a product, press **Check now**, and confirm a new `Notification` row lands with `status = SENT`. Note the per-product cooldown (`Setting.defaultCooldownSecs`, default 1h) suppresses repeat sends — if the check produces a `SKIPPED` row for cooldown, that confirms the pipeline is alive but doesn't confirm the webhook. Check against a product that hasn't notified recently, or temporarily lower the cooldown in Settings.
5. **Confirm the banner clears.** It disappears once a successful delivery breaks the consecutive-failure streak.

> `docs/SDLC.md` §9 and the failure table above both mention `POST /api/notifications/test` as a probe endpoint. **That endpoint is not implemented** — it's plan §11 API surface that hasn't been built. Use the "Check now" path in step 4 instead until it exists.

## Rollback (Railway)

Per `docs/SDLC.md` §8, Railway is this project's deploy target; `web` and `worker` run as separate services from `Dockerfile.web` and `Dockerfile.worker`. Railway keeps prior deploys, so rollback is redeploying the last known-good image rather than reverting code first.

```bash
# List recent deployments for a service (run once per service: web, worker)
railway status --service web
railway status --service worker

# Roll back a specific service to its previous deployment via the dashboard:
# Railway dashboard -> project -> service -> Deployments tab -> "..." on the
# last known-good deploy -> Redeploy. (Railway CLI does not currently expose
# a direct "rollback to deployment ID" command — the dashboard action is the
# supported path.)

# Alternative: redeploy the current HEAD of a known-good commit/tag directly
railway up --service web
railway up --service worker
```

After rolling back either service, re-run the release verification steps (`docs/SDLC.md` §8):

1. `/api/health` returns 200 with `db: "ok"` and a fresh `lastCheck`.
2. Watch one full worker cycle in logs — confirm at least one adapter check completed.
3. `POST /api/notifications/test` to confirm the notification path survived.
4. Spot-check the dashboard loads and shows current product status.

**Bad migration rollback** is a different path — see below, don't just redeploy an old image on top of a schema change that already ran.

## Database restore (`pg_dump`)

Use when a destructive migration needs undoing, or data loss is suspected. Per `docs/SDLC.md` §8: **never attempt a destructive migration without a tested rollback path ready first** — this procedure assumes a `pg_dump` backup already exists from before the incident.

```bash
# Take a fresh dump before touching anything, even if things look broken
# (you may need this exact broken state for diagnosis later):
pg_dump "$DATABASE_URL" -F c -f pre-incident-$(date +%Y%m%d-%H%M).dump

# Restore a prior dump into a NEW database first — never restore directly
# on top of the live DB:
createdb -h <host> -U <user> pokemon_monitor_restore
pg_restore -h <host> -U <user> -d pokemon_monitor_restore pre-incident-backup.dump

# Verify the restored data looks right (spot-check row counts, recent
# StockCheck/StockEvent timestamps) before cutting over:
psql -h <host> -U <user> -d pokemon_monitor_restore -c \
  "SELECT count(*) FROM \"StockCheck\" WHERE \"checkedAt\" > now() - interval '1 day';"

# Only once verified: point DATABASE_URL at the restored DB (Railway env var
# update for both web and worker services), or rename databases to swap them.
```

## Incident logging

Every production incident gets an entry — `docs/incidents/YYYY-MM-DD-<slug>.md`, or a GitHub issue with the `incident` label (the `.github/ISSUE_TEMPLATE/incident.yml` form). If it caused a **missed restock**, **>1 hour of downtime**, or **data loss**, it also needs a postmortem using the template at [`docs/incidents/_template.md`](incidents/_template.md), filed within 24–48h per `docs/SDLC.md` §4/§9.
