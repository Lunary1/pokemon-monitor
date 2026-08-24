---
name: handle-issue
description: Use when picking up a GitHub issue on this repo to implement, fix, or close it — takes an issue number (or a description to find/create one) and drives it through the SDLC phase model in docs/SDLC.md, from scope validation to a PR-ready branch. Trigger phrases: "work on issue #N", "handle issue #N", "pick up #N", "let's do the next issue", "implement issue N".
---

# Handle Issue

Drive a GitHub issue through this repo's SDLC (`docs/SDLC.md`) end to end: validate scope, design on paper if needed, implement the smallest correct change, test proportional to risk, open a PR meeting the Definition of Done.

`docs/SDLC.md` is authoritative. If this skill and that doc ever disagree, re-read the doc, follow it, and flag the mismatch to the user.

## Efficiency

- Don't `Read` `docs/SDLC.md` or the plan doc in full each phase — `Grep` for the section named in that phase (e.g. "§5" or "Won't-Have") and read only that excerpt. Full read at most once per issue, if genuinely needed.
- Don't spawn `Agent`/`Explore` subagents for XS/S issues — direct `Grep`/`Read`/`Edit` is cheaper than cold-starting another context.
- Batch independent read-only calls (issue fetch, `git status`, `git branch --show-current`, label check) into one parallel round instead of sequential turns.
- Status updates to the user: one line per phase transition. Don't restate the checklist verbatim — report deltas and failures only.
- Never paste full diffs, fixture HTML, or file contents into chat — reference `file:line` instead.

## Inputs

- Issue number (`#N`) — fetch first: `gh issue view <N> --repo <owner>/<repo> --json number,title,body,labels,milestone,state,assignees`. Closed issue → stop, tell the user.
- Description, no issue yet → create one (Phase 0) before continuing.
- "Next issue" → list open issues in the earliest open milestone, ask which (or take lowest-numbered if told to just pick).

## Phase 0 — Scope gate

Per SDLC §2/§11: no issue proceeds without a size label (`size/xs|s|m|l`) **and** a MoSCoW label (`must-have|should-have|could-have`).

1. Missing either label → infer from issue body + the plan doc (`pokemon-monitor-plan---*.md`), state reasoning in 1-2 sentences, apply via `gh issue edit <N> --add-label "size/x,tier"`. Never proceed unlabeled.
2. Check against the plan's exclusion lists (plan §1, §16, closing section: auth, multi-user, checkout automation, proxy rotation, CAPTCHA bypass, stealth plugins, a queue/plugin-marketplace before it's needed, WebSockets). Issue asks for one → stop, get an explicit written override from the user.
3. Vague issue ("improve the dashboard") → tighten into a 3-5 line problem statement; post as an issue comment if you materially reinterpreted the ask.
4. No issue yet → `gh issue create`, sized/labeled per above, before writing code.

## Phase 1 — Design gate

Required for M/L work, any new adapter, any schema change, any new API route. Skip entirely for XS/S changes outside those. Post the result as an issue comment before writing code:

- **New adapter:** pick the highest-priority tier that fits (plan §5): Shopify/JSON endpoint > embedded `__NEXT_DATA__`/JSON-LD > HTML via `got`+`cheerio` > Playwright (last resort, plan §10). State the tier and why higher ones don't apply.
- **Schema change:** Prisma model delta; additive or destructive. Destructive → sketch a rollback now (blocks merge at §8 otherwise).
- **New API route:** route, request/response shape, current consumers.
- **Other M/L:** short paragraph on the approach and the rejected alternative.

## Phase 2 — Implementation

1. Never work directly on `main`/`develop` — check `git branch --show-current` first. Branch `feat|fix|chore/<scope>-<short-desc>` from `develop` (`main` only for a hotfix, see below); scope matches existing packages (`adapters`, `worker`, `notifications`, `db`, `web`, `core`). Unrelated uncommitted work already on the current branch → ask before branching away.
2. Constraints (SDLC §2 Phase 2 / plan §9):
   - Adapters never import `packages/db` — they return data, callers persist it.
   - Adapters never throw from `checkProduct()` — always return a `StockResult`, errors as an `ERROR:`-prefixed availability string.
   - Selector strings live in a `SELECTORS` constant at the top of the adapter file.
   - No hardcoded polling intervals — read `Store.pollingInterval`.
   - New domain → respect `robots.txt` and the per-domain `minIntervalMs` throttle (merge gate, SDLC §7).
3. Commit in small atomic units, Conventional Commits matching repo history: `type(scope): description (#N)`. Types: `feat|fix|test|chore|refactor|docs`.
4. New env var → update `.env.example` in the same commits (SDLC §8/§11 gate).
5. No abstractions, config, or generality beyond what the issue asked for.

## Phase 3 — Testing (mandatory for adapters)

Per SDLC §6, proportional to risk:

| Changed | Required |
|---|---|
| `StoreAdapter` impl | in-stock fixture test + out-of-stock fixture test + network-error test asserting `checkProduct` returns an error result, never throws. Hard-required, no exceptions. |
| Store HTML changed | refresh fixture HTML, update selectors, keep old fixture under a `legacy/` note (plan §13) |
| Transition/debounce/cooldown/backoff logic | unit test for the specific edge case (e.g. flapping, cooldown boundary) |
| API route under `apps/web/app/api/**` | integration test against a test DB, assert persisted row/response shape |
| Dashboard UI | Playwright E2E only if release-bound; not required per-PR unless UI-only |

Before calling this phase done, run and confirm clean: `npm run typecheck && npm run build && npm run test` — this is CI until issue #7 lands.

## Phase 4 — PR

Template (SDLC §5):

```markdown
## What
## Why
## Design note
(paste Phase 1 output if it applied; omit otherwise)
## Testing
- [ ] Unit tests added/updated
- [ ] Fixtures added/updated (adapter changes only)
- [ ] Manually verified locally
## Migration plan
(schema changes only)
## Rollback plan
(schema or worker/web contract changes only)
```

Definition of Done (SDLC §11) — check against your own diff before opening the PR, fix gaps rather than noting them:

- [ ] Tests added/updated and passing
- [ ] `.env.example` updated if new env vars introduced
- [ ] No new secrets in the diff
- [ ] Adapter changes: fixtures updated, respects `robots.txt`/`minIntervalMs`
- [ ] Schema changes: migration tested locally, rollback plan in the PR
- [ ] PR references the issue (`Closes #N` only if fully resolved, else `Refs #N`)

`gh pr create`, base `develop` (`main` for a hotfix). Report the PR URL and a one-line status to the user. Never merge, push to `main`/`develop`, or force-push — merging is the user's call.

## Hotfix shortcut

Live production issue (worker down, notification storm, adapter broken in prod) → compressed path (SDLC §5):

1. Confirm it's real: check `/api/health`, `ErrorLog`, recent `StockCheck` rows — could be the target site, not your code.
2. Branch `hotfix/<slug>` from `main`.
3. Fix + minimal regression test; skip Phase 0/1 ceremony, a one-line problem statement in the PR is enough.
4. PR base `main`; note it also needs merging back into `develop`.
5. Flag (don't write) postmortem need if this caused a missed restock or >1h downtime (SDLC §4 template).

## Guardrails

- Mid-implementation the issue turns out bigger than its label (S needs a schema change) → stop, say so, re-label rather than finishing quietly under the old label.
- A scope/schema/adapter-allow-list decision the issue and plan don't resolve → ask, don't guess.
- One issue, one branch, one PR — unrelated fixes noticed along the way become new issues (`tech-debt` label if cleanup, not a bug).
