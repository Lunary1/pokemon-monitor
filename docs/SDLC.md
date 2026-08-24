# Pokémon Product Monitor — SDLC Operating Model

> Applies to: `Lunary1/pokemon-monitor` (TypeScript / Next.js / Prisma / PostgreSQL / Playwright)
> Audience: solo developer or 1–3 person team operating this as a serious personal-use project
> Companion to: `pokemon-monitor-plan---bd38ec25-06b0-478a-96ab-64d5a3efd1fb.md` (the product/technical plan)

This document defines *how work moves*, not *what to build*. The technical plan says what the system is. This says how an idea becomes a deployed, monitored, maintainable feature — repeatably, without turning a personal project into either chaos or bureaucracy.

---

## 1. SDLC Overview

The lifecycle has one loop, run continuously, with a shorter emergency path for production incidents.

```
IDEA → SCOPE → DESIGN → BUILD → VERIFY → RELEASE → OPERATE → LEARN → (back to IDEA)
                                                        │
                                                        └─ INCIDENT → HOTFIX → RELEASE → LEARN
```

**In plain language:**

1. Something triggers work — a new store to track, a bug report, a broken adapter, a "wouldn't it be nice if." That's **idea intake**.
2. Before code, the idea gets sized and bounded: is this a 30-minute adapter tweak or a new subsystem? That's **discovery and scope control** — the single most important discipline for a project with a strong tendency to overengineer (see plan §15, "Overengineering: High/High").
3. Anything touching more than one package, the DB schema, or an external contract gets a short **design note** before code — a paragraph, not a document.
4. **Implementation** happens on a short-lived branch against `develop`, in small commits.
5. **Verification** runs the layered test model (§6) proportional to risk — an adapter selector fix needs a fixture test; a schema migration needs a migration plan and a staging dry run.
6. **Release preparation** produces a checklist-backed, reversible deployment.
7. **Deployment** promotes through local → staging (optional, see §8) → production via Docker images on Railway/Fly.io, with an explicit rollback path.
8. **Monitoring and operations** watches the four things that can silently fail in this system: the worker loop, adapters, the notification path, and the database.
9. **Continuous improvement** feeds incidents, flaky adapters, and backlog items back into the next idea-intake cycle.

The **hotfix path** is a compressed version of the same loop for production-breaking issues (e.g., an adapter silently returning false negatives, a notification storm, a crashed worker): scope is skipped in favor of a one-line problem statement, testing is narrowed to the regression that caused the incident, and a postmortem is mandatory afterward.

**Why this shape for this project specifically:** the plan already identifies the two dominant risk categories — *fragile scraping* (adapters break when store HTML changes) and *scope creep* (plan §15, §16, "What to Avoid Building Early"). The SDLC below is built to catch both: fixture-based regression testing catches the first, and mandatory scope statements + a strict Definition of Ready catch the second.

---

## 2. Phase Model

### Phase 0 — Discovery and Scope Control

| | |
|---|---|
| **Purpose** | Decide if an idea is worth doing now, and bound it before it grows |
| **Inputs** | Bug report, new store request, feature idea, incident follow-up, backlog item |
| **Activities** | Write a 3–5 line feature brief; classify against MoSCoW (plan §16); check it against "What to Avoid Building Early" (plan, end); size as XS/S/M/L |
| **Deliverables** | Feature brief (GitHub issue using the Feature template) |
| **Exit criteria** | Issue has a clear problem statement, a size, a MoSCoW tag, and — if size ≥ M — an explicit "why now" |
| **Common failure modes** | Silent scope growth ("while I'm in there..."); building infrastructure (queues, plugin systems, auth) before it's needed; skipping this phase for "small" changes that turn out not to be |
| **Quality gate** | **No issue moves to Design/Build without a size label and a MoSCoW label.**

### Phase 1 — Architecture and Design

| | |
|---|---|
| **Purpose** | Resolve design questions cheaply, on paper, before they're expensive in code |
| **Inputs** | Scoped feature brief |
| **Activities** | For new adapters: confirm data source (JSON API > embedded JSON > HTML scraping, per plan §5 "Using APIs When Available") and note selectors/endpoints. For schema changes: draft the Prisma model delta and migration approach. For API changes: note the route, request/response shape, and consumers |
| **Deliverables** | Design note (a comment on the issue, or a short section in the PR description — not a separate doc unless the change spans ≥3 packages) |
| **Exit criteria** | Any DB migration has a stated rollback approach; any new adapter states which data source tier it uses and why; any new external dependency is justified |
| **Quality gate** | Design note exists in the issue/PR **before** the first line of implementation code for anything M/L sized |

### Phase 2 — Implementation

| | |
|---|---|
| **Purpose** | Write the smallest correct change that satisfies the brief |
| **Inputs** | Design note, scoped issue |
| **Activities** | Branch from `develop`; implement; keep adapters free of DB imports (plan §9 "Maintainability Guidelines"); keep selectors in a `SELECTORS` constant; commit in small, reviewable units |
| **Deliverables** | Feature branch with commits following Conventional Commits (matches existing history: `feat(adapters): ...`, `test(adapters): ...`) |
| **Exit criteria** | Code compiles, lints, and typechecks locally (`npm run typecheck`); no TODOs without a linked follow-up issue |
| **Common failure modes** | Adapter logic reaching into `packages/db`; hardcoded polling intervals instead of reading `Store.pollingInterval`; skipping the "returns error result, never throws" contract for `checkProduct` |
| **Quality gate** | `npm run build && npm run typecheck` clean before opening a PR |

### Phase 3 — Verification and Testing

| | |
|---|---|
| **Purpose** | Prove the change works and didn't break anything else, proportional to risk |
| **Inputs** | Implementation on a branch |
| **Activities** | Run the layered test suite per §6; for adapters, add/update HTML fixtures for in-stock and out-of-stock states; for worker logic, verify transition/debounce behavior; for API routes, run integration tests against a test DB |
| **Deliverables** | Passing test run (local + CI once CI exists — see §8 note); updated fixtures committed alongside adapter changes |
| **Exit criteria** | All tests green; new logic has new tests; no reduction in coverage for `packages/store-adapters` (the highest-risk, highest-churn package) |
| **Common failure modes** | Testing the happy path only and skipping the "network error → error result, not throw" case; forgetting to update the legacy fixture note when a store's HTML changes |
| **Quality gate** | PR cannot merge with failing tests. Adapter PRs cannot merge without a fixture-based unit test |

### Phase 4 — Release Preparation

| | |
|---|---|
| **Purpose** | Make the release boring — known contents, known risk, known rollback |
| **Inputs** | Merged PR(s) on `develop` |
| **Activities** | Update the release checklist (§4); confirm migrations are additive/backward-compatible or have a documented rollback; confirm env var changes are reflected in `.env.example`; bump version if applicable |
| **Deliverables** | Release checklist filled out (as a PR description or release issue) |
| **Exit criteria** | Checklist complete; migration plan exists for any schema change; rollback plan exists |
| **Common failure modes** | Deploying a schema migration and a risky feature in the same release (bundle only what you can roll back together); forgetting to update `.env.example` when a new secret is introduced |
| **Quality gate** | Release checklist attached before merge to `main` |

### Phase 5 — Deployment

| | |
|---|---|
| **Purpose** | Ship the release with a known-good path and a fast way back |
| **Inputs** | `main` branch at the release commit |
| **Activities** | Build Docker images (`Dockerfile.web`, `Dockerfile.worker`); run `prisma migrate deploy`; deploy `web` and `worker` as separate Railway/Fly services; verify `/api/health` |
| **Deliverables** | Deployed services; deployment logged (date, commit SHA, what changed) |
| **Exit criteria** | `/api/health` returns 200 with `db: ok` and a recent `lastCheck`; worker is processing products (visible in logs or dashboard) |
| **Common failure modes** | Migrating the DB without a rollback plan; deploying worker and web out of sync when a contract between them changed; secrets committed instead of set in Railway/Fly dashboard |
| **Quality gate** | Health check green within 5 minutes of deploy, or roll back |

### Phase 6 — Monitoring and Operations

| | |
|---|---|
| **Purpose** | Know when something breaks before a missed restock tells you |
| **Inputs** | Running production system |
| **Activities** | External uptime check on `/api/health` (UptimeRobot, per plan §13); watch `ErrorLog` table / log viewer; watch adapter DEGRADED state (plan §5 backoff strategy) |
| **Deliverables** | Populated `ErrorLog`, `StockCheck` history; incident log entries when something breaks |
| **Exit criteria** | N/A — continuous. Reviewed weekly (§12) |
| **Common failure modes** | Worker dies silently with no external check; adapter degrades to "always false" without alerting; notification channel itself fails silently (Discord webhook revoked/rate-limited) |
| **Quality gate** | Every production incident gets an `ErrorLog` entry or it didn't officially happen — retroactively backfill if the automated path missed it |

### Phase 7 — Continuous Improvement

| | |
|---|---|
| **Purpose** | Turn operational reality into the next cycle's backlog |
| **Inputs** | Incidents, broken adapters, user (i.e., your own) friction, stale dependencies |
| **Activities** | Weekly-ish backlog grooming (§12); postmortem for any incident that caused a missed restock or >1 hour of downtime; dependency/security review (§7) |
| **Deliverables** | Updated backlog; postmortem doc for real incidents; technical debt items logged as issues with a `tech-debt` label |
| **Exit criteria** | N/A — continuous | 
| **Common failure modes** | Debt accumulating invisibly because it's never written down; the same adapter breaking repeatedly without ever getting a more robust data source (e.g., switching to a JSON endpoint) |
| **Quality gate** | Any adapter that breaks 2+ times in 30 days gets a mandatory design review to find a more stable data source |

---

## 3. Role and Responsibility Model

This is realistically a **1-person team wearing every hat**, possibly a **2-person team** (you + one collaborator). The model below names the responsibilities so nothing is silently dropped — not to imply headcount you don't have.

| Responsibility area | Owner (solo) | Notes |
|---|---|---|
| Product decisions (scope, prioritization, MoSCoW calls) | You, as **Product Owner** | Final say on what's in/out. Use plan §1 and §16 as the standing default; deviations need explicit sign-off (from yourself, in writing, in the issue) |
| Architecture and design review | You, as **Tech Lead** | Applies the Phase 1 gate; the one role allowed to say "this needs a design note" |
| Implementation | You, as **Engineer** | Phases 2–3 |
| Test authorship and adapter fixture maintenance | You, as **QA** | Owns §6; especially fixture upkeep, the project's highest-leverage test investment |
| CI/CD, Docker, Railway/Fly config, secrets | You, as **DevOps** | Owns §8; the only role with production credential access |
| Dependency and secret hygiene, robots.txt/ToS compliance | You, as **Security** | Owns §7; reviews before every release, not just when something feels risky |
| Uptime, incident response, on-call (informal) | You, as **Operations** | Owns §9; you are your own pager |
| If a second person joins | Split by package ownership (e.g., one owns `store-adapters`, the other owns `apps/web`) | Requires code review to become mandatory (currently optional at 1 person) rather than advisory, and CODEOWNERS to route reviews |

**Rule of thumb:** when wearing the Product Owner hat, resist the Engineer hat's urge to gold-plate. When wearing the Security/DevOps hat, don't let the Engineer hat skip the checklist because "it's just me." Naming the hats is what keeps a solo project disciplined.

---

## 4. Artifact Checklist

| Stage | Artifact | Format | Required for |
|---|---|---|---|
| Discovery | Feature brief | GitHub issue (Feature template) | All work ≥ S size |
| Discovery | MoSCoW + size label | GitHub labels | All issues |
| Design | Design note | Issue comment or PR description section | M/L work, new adapters, schema changes, new API routes |
| Design | Migration plan | PR description section ("Migration Plan") | Any Prisma schema change |
| Implementation | Conventional commits | Git history | All commits |
| Verification | Test plan (implicit via checklist) | PR template checkbox section | All PRs |
| Verification | Adapter fixtures (in-stock + out-of-stock HTML) | `packages/store-adapters/__tests__/fixtures/*.html` | All adapter PRs |
| Release | Release checklist | GitHub release issue or PR description | Every deploy to `main` |
| Release | Rollback plan | Section in release checklist | Every deploy touching DB schema or worker/web contract |
| Deployment | Runbook | `docs/RUNBOOK.md` | Always current, referenced during incidents |
| Operations | Incident log | `docs/incidents/YYYY-MM-DD-<slug>.md` or GitHub issue with `incident` label | Any production incident |
| Operations | Postmortem | `docs/incidents/.../postmortem.md` (template below) | Any incident causing a missed restock, >1h downtime, or data loss |
| Governance | Definition of Done | `docs/SDLC.md` §11 (this doc) | Standing reference |
| Governance | Risk register | `docs/RISK_REGISTER.md` (seeded from plan §15) | Reviewed at each retro |

**Postmortem template** (`docs/incidents/_template.md`):

```markdown
# Incident: <title>

- Date:
- Detected by: (UptimeRobot / manual / Discord silence noticed)
- Duration:
- Severity: (missed restock / downtime / data issue / false-positive spam)

## What happened
## Root cause
## Impact
## What went well
## What to fix
- [ ] Action item (linked issue)
```

---

## 5. Engineering Workflow

### Branching

- `main` — always deployable; every commit on `main` has been released.
- `develop` — integration branch; matches the current repo default working branch pattern (`feat/phase-1-monitor` naming shows short-lived feature branches are already the convention).
- Feature branches: `feat/<scope>-<short-desc>`, `fix/<scope>-<short-desc>`, `chore/<scope>-<short-desc>` — consistent with existing commit scopes (`adapters`, `worker`, `notifications`, `db`, `core`).
- Hotfix branches: `hotfix/<short-desc>` branched from `main`, merged to both `main` and `develop`.

### Commit hygiene

Already established by the existing history (`feat(adapters): add ToyChamp adapter (#2)`) — keep it:

- Conventional Commits: `type(scope): description`.
- Types: `feat`, `fix`, `test`, `chore`, `refactor`, `docs`.
- Scope = package or area (`adapters`, `worker`, `notifications`, `db`, `web`, `core`).
- Reference the issue number in the commit or PR (`(#N)`), matching existing practice.
- Small, logically atomic commits over one giant commit.

### Code review

- **Solo:** self-review via PR diff view before merge — do not push directly to `main`. Use the PR description checklist as a forcing function (§4).
- **2-person:** mandatory 1 approval before merge; CODEOWNERS routes adapter changes and schema changes to the person who didn't write them if possible.
- **Always required regardless of team size:** a PR touching `packages/db/prisma/schema.prisma` gets read twice — once for the change, once for the migration file it generated.

### Merge criteria

1. CI green (once CI exists — see §8 gap note).
2. Typecheck and build clean.
3. Tests added/updated for the change (§6).
4. PR description checklist complete (template below).
5. No secrets in diff (manual scan is fine at this scale; see §7).

### PR template checklist (target for `.github/PULL_REQUEST_TEMPLATE.md`)

```markdown
## What
## Why
## Design note (if M/L or new adapter/schema/route)
## Testing
- [ ] Unit tests added/updated
- [ ] Fixtures added/updated (adapter changes only)
- [ ] Manually verified locally
## Migration plan (schema changes only)
## Rollback plan (schema/worker-web contract changes only)
```

### Hotfix / urgent production issue flow

1. Confirm it's real: check `/api/health`, `ErrorLog`, and recent `StockCheck` rows before assuming code is at fault (could be the store's site, not you).
2. Branch `hotfix/<slug>` from `main`.
3. Fix + minimal regression test (the fixture or case that would have caught it).
4. Skip the full Phase 0–1 ceremony — a one-line problem statement in the PR is enough.
5. Deploy directly following §8's fast path.
6. Merge `hotfix/*` back into both `main` and `develop`.
7. File a postmortem within 24–48h if it meets the bar in §4.

---

## 6. Testing Strategy

Layered and **risk-weighted** — the plan already has good bones here (plan §13); this ties each layer to what it protects against.

| Layer | Tool | What it covers | Risk mitigated | Required before |
|---|---|---|---|---|
| Unit — adapters | Vitest + HTML fixtures | `checkProduct()` parsing logic for in-stock/out-of-stock/error states | Silent false negatives (missed restock) or false positives (spam); store HTML changes | Merge (mandatory for any adapter change) |
| Unit — core logic | Vitest | Transition detection (`RESTOCK`/`OUT_OF_STOCK`), debounce counters, cooldown math, backoff schedule | Flapping alerts, notification spam, incorrect state transitions | Merge |
| Integration — API + DB | Vitest against a test PostgreSQL instance | Route handlers, Prisma queries, manual check trigger | Broken API contracts, bad migrations, incorrect persisted state | Merge (for any `apps/web/app/api/**` change) |
| E2E — dashboard | Playwright | Product list renders, status badges show, manual trigger button works | Dashboard regressions that unit/integration tests can't see | Release (not required per-PR unless the PR touches UI directly) |
| Regression — adapter drift | Vitest + refreshed fixtures | Store changed their HTML/layout | Adapter silently going dark | Whenever an adapter is reported broken (part of hotfix flow) |
| Smoke — post-deploy | `curl /api/health`, watch one worker cycle | Service is up, DB reachable, worker running | Bad deploy going unnoticed | Every deployment (§8) |
| Manual — Playwright helper flows | Manual run | "Open page" and "prefill form" don't auto-submit, selectors still match | Accidental automated checkout (explicitly out of scope, plan §10) | Whenever a store's checkout page layout changes |

**Before merge (every PR):** unit tests for changed logic, integration tests for changed API routes, fixture tests for changed adapters. No PR merges with red tests.

**Before release (`main` deploy):** full suite green, plus a manual smoke pass on the dashboard if UI changed, plus E2E suite if `apps/web` changed.

**Coverage stance:** don't chase a coverage percentage. Instead, enforce a rule: **every `StoreAdapter` implementation must have both an in-stock and out-of-stock fixture test, plus one error-path test.** That's the one place this project cannot afford silent failure — an adapter that always returns `inStock: false` on a parse error is indistinguishable from "actually out of stock" without that test.

---

## 7. Security and Compliance

Scoped appropriately for a personal-use tool — no SOC2 theater, but the real risks named in plan §15 get concrete controls.

| Area | Control | Why |
|---|---|---|
| Secrets | `.env.local` for local dev (gitignored), Railway/Fly environment dashboard for production. Never in code, never in commit history, never in `.env.example` (which stays as documented empty placeholders) | Discord webhook URLs and any future API keys are the only real secrets; a leaked webhook lets someone spam your Discord | 
| Secret scanning | **Confirmed unavailable on this repo's current plan tier** — GitHub's built-in secret scanning + push protection require GitHub Advanced Security for private repositories (verified via the API: `PATCH .../security_and_analysis` returns "Secret scanning is not available for this repository"). Mitigate manually until either the repo goes public or Advanced Security is purchased: scan your own diff for anything token/key/webhook-shaped before every commit (already part of this doc's PR checklist) | Cheap insurance normally, but gated behind a paid tier for a private repo; manual review is the fallback control |
| Dependency hygiene | Dependabot security updates **enabled** (`security_and_analysis.dependabot_security_updates.status: enabled`, confirmed via API as of 2026-08-05) plus `.github/dependabot.yml` (weekly npm scan, root directory) generating update PRs; `npm audit` as a manual supplement at each release prep phase for anything Dependabot doesn't catch between its weekly runs | Small surface area, but `got`/`cheerio`/`playwright` all touch untrusted external content |
| Dependency updates | Dependabot groups minor/patch npm updates into one PR per week (`.github/dependabot.yml`); major version bumps are left ungrouped so each gets its own PR requiring a design note before merge, per this section | Keeps drift low without manual toil, while still gating majors |
| robots.txt / ToS compliance | Already specified in plan §5 — enforce it as a **quality gate**, not just a feature: no adapter merges without respecting `robots.txt` unless `ignoreRobotsTxt` is explicitly and knowingly set per-store | This is the project's actual legal/ethical risk surface (plan §15: "Legal / ToS concerns") |
| Rate limiting / good citizenship | Per-domain `minIntervalMs` throttle (plan §5) is a merge-blocking requirement for any new adapter, not optional | Prevents accidental DoS-like behavior against small stores; protects the project's own IP from bans |
| Least privilege | Worker process only needs DB write access to its own tables; no adapter code should ever need filesystem or shell access beyond what `playwright-helper` explicitly requires | Contains blast radius of a compromised dependency in `store-adapters` |
| Access control | None needed (plan explicitly excludes auth for MVP) — but if the dashboard is ever deployed publicly reachable, it must go behind at minimum a basic auth proxy or IP allowlist before that happens | The plan assumes a private deployment; don't accidentally expose product-tracking data or the manual-check endpoint publicly |

---

## 8. Release and Deployment Model

### Environments

| Environment | Purpose | Notes |
|---|---|---|
| Local | Development | `docker compose up -d` (Postgres, optionally Redis) + `npm run dev` |
| Staging | *Optional, recommended once adapters > 3 or schema changes get risky* | A second Railway/Fly project with its own DB, seeded with a couple of test products. Skip for true single-person low-stakes phases; add before any migration you're not 100% sure about |
| Production | Live monitoring | Railway (or Fly.io) — `web` and `worker` as separate services per plan §14 |

### Promotion rule

`feature branch → develop → main → deploy`. Nothing deploys to production from a branch other than `main`. If staging exists, `main` deploys to staging first, verified, then promoted to production (can be the same deploy if staging is skipped, per project's actual current maturity).

### Docker / Compose / env vars

- `docker-compose.yml` is the source of truth for local service topology (Postgres, optionally Redis, `web`, `worker`).
- `Dockerfile.web` and `Dockerfile.worker` build independently deployable images — keep them that way; don't collapse them into one image, since the plan deploys them as separate Railway services.
- `.env.example` must be updated in the **same PR** that introduces a new environment variable — treat a missing `.env.example` entry as a blocking review comment.
- Production secrets live only in the Railway/Fly dashboard.

### Release verification steps

1. Migrations applied (`prisma migrate deploy`) — never `migrate dev` against production.
2. `GET /api/health` returns 200, `db: ok`, and a `lastCheck` timestamp from within the last polling interval.
3. Watch one full worker cycle in logs — confirm at least one adapter check completed.
4. Send a test Discord notification (`POST /api/notifications/test`, per plan §11) to confirm the notification path survived the deploy.
5. Spot-check the dashboard loads and shows current product status.

### Rollback strategy

| Failure mode | Rollback action |
|---|---|
| Bad `web` deploy (dashboard/API broken) | Redeploy previous Railway/Fly image (Railway keeps prior deploys — one-click rollback) |
| Bad `worker` deploy (worker crashing/looping) | Redeploy previous worker image; if a bad migration is the cause, see below |
| Bad migration (additive, backward-compatible) | Roll forward with a fix; additive migrations are rarely worth rolling back |
| Bad migration (destructive: dropped/renamed column) | Restore from the most recent `pg_dump` backup (plan §14) to a new DB, or apply a hand-written down-migration prepared in advance for any destructive schema change — **never attempt a destructive migration without a tested rollback path ready first** |
| Notification storm / spam | Flip `Setting.notificationsEnabled` to false via a direct DB update or settings UI as an immediate mitigation, then diagnose |

**Rule:** any migration that drops a column, drops a table, or changes a type in a non-widening way requires a pre-written rollback script *before* it's allowed to merge, per the Phase 4 gate.

---

## 9. Observability and Operations

| Component | What to watch | Signal | Tool |
|---|---|---|---|
| Worker | Is it running at all? Is it completing cycles? | `/api/health` `lastCheck` timestamp not stale beyond 2x the polling interval | UptimeRobot (free tier) pinging `/api/health` every 5 min, per plan §13 |
| Worker | Adapter-level health | Consecutive failure count per adapter; `DEGRADED` state (plan §5 backoff) | Dashboard log viewer + `ErrorLog` source filter (`adapter:<key>`) |
| API/Web | Is the dashboard reachable? | HTTP 200 on `/` and `/api/health` | Same UptimeRobot check |
| Database | Connection health, growth | `/api/health` `db: ok`; periodic check that `StockCheck` retention (30-day purge, plan §4.8) is actually running | Manual/cron `pg_dump` size check monthly |
| Notification path | Are Discord messages actually arriving? | `Notification.status` distribution (`SENT` vs `FAILED`); a stuck `PENDING` queue | Weekly glance at `/api/notifications` list; the `POST /api/notifications/test` endpoint as an active probe |
| Logs | Structured, queryable | `pino` JSON logs, `ErrorLog` table with `source`/`level`/`context` | Dashboard log viewer (plan §4.9); no external log aggregator needed at this scale |

### Alerting

- **Primary channel:** the same Discord webhook used for restocks, with a distinct message style (e.g., a red embed) for `ADAPTER_ERROR` and health-check failures — you already have the delivery mechanism, use it for ops alerts too instead of adding a second tool.
- **External-to-the-system check:** UptimeRobot must alert via a channel independent of Discord-through-this-app (e.g., UptimeRobot's own email/Telegram) — otherwise a fully-down app can't alert you that it's down.

### Incident response steps

1. **Detect** — UptimeRobot alert, Discord silence noticed, or manual check.
2. **Triage** — hit `/api/health`; check `ErrorLog` for the relevant `source`; check Railway/Fly service logs and status.
3. **Contain** — if it's spam/false positives, disable notifications (`Setting.notificationsEnabled = false`); if it's a crash loop, roll back to the last known-good deploy (§8).
4. **Fix** — via the hotfix flow (§5) if code-caused; via store-side adapter update if the site changed; wait it out with backoff if it's a transient rate-limit.
5. **Verify recovery** — re-run release verification steps (§8).
6. **Log** — incident entry (§4); postmortem if it meets the bar.

---

## 10. Continuous Improvement Loop

- **Incidents → backlog:** every postmortem's "What to fix" action items become issues with an `incident-followup` label, prioritized above net-new features until resolved.
- **Broken adapters → design review:** an adapter that breaks twice in 30 days triggers the Phase 7 gate — evaluate switching to a more stable data source (JSON endpoint over HTML scraping, per plan §5's data-source priority order) rather than patching selectors indefinitely.
- **Backlog grooming:** light-touch, folded into the weekly cadence (§12) — re-scan open issues, re-confirm MoSCoW tags still hold, close anything that's aged out of relevance.
- **Technical debt:** tagged with a `tech-debt` label at the moment it's introduced (e.g., "hardcoded this selector, should extract to config later") rather than discovered later. Reviewed at each retro; anything untouched after 3 review cycles gets explicitly killed or scheduled.
- **Dependency/security review:** part of every release prep (§7), not a separate cadence.
- **Risk register review:** the seeded table in `docs/RISK_REGISTER.md` (from plan §15) gets a likelihood/impact re-check at each retro — risks materialize or fade as the system matures (e.g., "database grows unbounded" stops being Low/Low once retention policy is actually implemented and verified).

---

## 11. SDLC Governance

### Change eligibility ("ready for Build")

A change may enter Phase 2 (Implementation) only when:

- [ ] It has a GitHub issue with a size label (XS/S/M/L) and a MoSCoW label
- [ ] It's not on the "Won't-Have" list (plan §16) or "What to Avoid Building Early" list (plan, closing section) — unless explicitly overridden with a written reason
- [ ] M/L-sized or schema/adapter/API-affecting changes have a design note

### Definition of Done

A change is **Done** only when:

- [ ] Code merged to `develop` (or `main` via hotfix)
- [ ] Tests added/updated and passing (per §6's risk-weighted requirements)
- [ ] `.env.example` updated if new env vars were introduced
- [ ] No new secrets in the diff
- [ ] Adapter changes: fixtures updated, respects `robots.txt` and `minIntervalMs`
- [ ] Schema changes: migration applied cleanly to a test DB, rollback plan documented
- [ ] Deployed to production and release verification steps passed (§8)
- [ ] Issue closed with a reference to the merging PR

### Release readiness checklist

```markdown
## Release Readiness — <date/tag>
- [ ] All included PRs merged to `main`
- [ ] CI green (or manual test suite run green, pre-CI)
- [ ] Migrations reviewed; rollback plan exists for destructive changes
- [ ] .env.example matches actual required env vars
- [ ] No secrets in diff
- [ ] Health check passes locally against production-like config
- [ ] Rollback plan documented for this release
- [ ] Backup taken immediately before migration (pg_dump)
```

### Risk register framework

Seed `docs/RISK_REGISTER.md` directly from plan §15's table (store HTML changes, false positives, rate limiting, legal/ToS, notification spam, checkout fragility, overengineering, silent worker crashes, unbounded DB growth). Structure:

| Risk | Likelihood | Impact | Mitigation | Status | Last reviewed |
|---|---|---|---|---|---|

Review at every retro (§12); update likelihood/impact as mitigations land or new evidence appears (e.g., an adapter that's broken 3 times moves "store HTML changes" for that specific store from Medium to High likelihood).

---

## 12. Recommended Operating Cadence

Lean, sized for 1–3 people, no ceremony that doesn't pay for itself.

| Cadence | Activity | Time budget |
|---|---|---|
| Continuous | Idea capture — any thought becomes a GitHub issue, even a one-liner, before it's forgotten | Ad hoc |
| Per change | Phase 0–5 as described above | Varies by size |
| Weekly (or whenever you sit down to work on it) | **Mini-retro:** scan open issues, re-confirm labels, check risk register, review any incidents since last session, groom backlog | 15–30 min |
| Per release | Release readiness checklist (§11) | 10–15 min |
| Monthly | Dependency/security sweep if not already forced by Dependabot; DB size/retention sanity check | 20–30 min |
| Per incident | Postmortem if it meets the bar (§4) | 20–40 min |
| Quarterly-ish | Zoom out: is the architecture still right? Any adapter chronically broken enough to redesign? Any "Should-Have" ready to promote? | 30–60 min |

No daily standups, no story points, no velocity tracking — those solve coordination problems this team size doesn't have.

---

## 13. Final SDLC Blueprint

A compressed, step-by-step operating model usable as a standing team standard:

1. **Capture** every idea as a GitHub issue immediately, however small.
2. **Scope** it: write a 3–5 line brief, size it (XS/S/M/L), tag it MoSCoW, check it against the exclusion lists in the plan.
3. **Design** on paper (an issue comment) if it's M/L, touches the schema, adds an adapter, or adds an API route. State the migration and rollback plan up front for schema work.
4. **Branch** from `develop` (`feat/`, `fix/`, `chore/` + scope), implement in small commits using Conventional Commits.
5. **Test** proportional to risk: fixture tests for adapters (mandatory, in-stock + out-of-stock + error), unit tests for transition/debounce/cooldown logic, integration tests for API routes.
6. **Review** the PR against the checklist (§5) — self-review if solo, one approval if 2+.
7. **Merge** to `develop` only with green tests, clean typecheck/build, and an updated `.env.example` if needed.
8. **Prepare release**: fill the release readiness checklist, confirm rollback plan, take a DB backup if migrating.
9. **Deploy** `main` via Docker images to Railway/Fly (`web` and `worker` as separate services); run `prisma migrate deploy`.
10. **Verify**: health check, one worker cycle, a test Discord notification, dashboard spot-check.
11. **Operate**: UptimeRobot watches `/api/health`; Discord doubles as the ops-alert channel; log viewer and `ErrorLog` are the first stop for any anomaly.
12. **Respond** to incidents via detect → triage → contain → fix → verify → log, using the hotfix branch flow for anything production-breaking.
13. **Learn**: postmortem real incidents, log tech debt the moment it's created, feed both back into the next Capture step.
14. **Review** weekly (light) and quarterly (zoom-out) — keep the risk register and backlog honest.

---

## Assumptions Made

Stated explicitly since the source plan doesn't resolve these:

1. **Team size is 1, possibly growing to 2–3.** The role model and review requirements are written to scale from solo self-review to mandatory peer review without restructuring.
2. **CI does not yet exist** (verified: no `.github/workflows` in the repo). This SDLC assumes CI (GitHub Actions running lint/typecheck/test on every PR) is set up early — it's the single highest-leverage gap versus the "perfect SDLC" goal, since right now nothing blocks a red PR from merging except discipline. Issues are created below to close this.
3. **Staging is optional, not mandatory**, given personal-use scale — recommended once schema changes carry real risk or adapters multiply, not required from day one.
4. **`develop` is the integration branch and `main` is production-deployed**, inferred from the existing `feat/phase-1-monitor` branch naming and standard GitHub flow; the plan itself doesn't specify a branching model.
5. **Railway is the default deploy target**, per the plan's stated preference, with Fly.io as the documented alternative — the SDLC doesn't force a choice, just requires the promotion/rollback discipline to hold for either.
6. **No enterprise compliance regime applies** (no SOC2, no GDPR data-subject tooling) since this is a personal tool processing no third-party user data beyond the operator's own checkout-prefill config, which is explicitly kept local and out of the database.

## What Should Be Tightened in the Original Plan

- **No CI is defined anywhere in the plan.** For a "perfect SDLC," this is the biggest gap — everything else (tests, gates, checklists) is advisory without CI enforcing it. Closing this is issue #1 below.
- **No PR/issue templates, no CODEOWNERS.** Cheap to add, and they're what make the Phase 0 and Phase 5 gates actually stick instead of relying on memory.
- **The plan's migration/rollback story is implicit.** Plan §14 covers backups but never states a rule for when a migration needs a pre-written rollback script. §8/§11 above make that explicit and mandatory for destructive migrations.
- **No incident/postmortem process existed in the plan.** Plan §15 lists risks well but stops at mitigation; it never closes the loop on "what do we do when it happens anyway." §4/§9 close that gap.
- **"Notification Service" error handling is underspecified** in plan §12 — what happens when Discord itself is down or the webhook is revoked? Recommend adding a `FAILED`-status alert path (e.g., write to `ErrorLog` and surface in the dashboard) so a dead webhook doesn't fail silently forever.
- **Health check exists but nothing defines *staleness* precisely.** Recommend "stale" = `lastCheck` older than 2× the shortest enabled `Store.pollingInterval" — worth adding to the `/api/health` implementation itself, not just this doc.

---

## Top 9 SDLC Rules

1. **No code without a scoped issue.** Size it, tag it MoSCoW, check it against the exclusion list before writing a line.
2. **Design on paper before code, but only when it's worth it** — M/L changes, schema changes, new adapters, new routes. Don't design a one-line selector fix.
3. **Every adapter ships with an in-stock fixture, an out-of-stock fixture, and an error-path test.** No exceptions — this is the project's single highest-leverage test investment.
4. **Adapters never throw and never touch the database.** They return `StockResult`, always.
5. **No destructive migration merges without a pre-written rollback script and a fresh backup.**
6. **Nothing deploys to production except from `main`, and every deploy is verified within 5 minutes** (health check, one worker cycle, one test notification).
7. **The moment something breaks, it gets logged** — `ErrorLog`, an issue, or both. If it caused a missed restock or an hour of downtime, it gets a postmortem.
8. **Respect `robots.txt` and per-domain throttling as a merge gate, not a suggestion** — it's the project's actual legal and ethical boundary.
9. **Review weekly, however briefly.** A 15-minute look at open issues, the risk register, and anything that broke is what keeps a solo project from quietly drifting into chaos.
