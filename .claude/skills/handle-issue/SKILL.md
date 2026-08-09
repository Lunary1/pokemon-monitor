---
name: handle-issue
description: Use when picking up a GitHub issue on this repo to implement, fix, or close it — takes an issue number (or a description to find/create one) and drives it through the full SDLC phase model in docs/SDLC.md, from scope validation through a PR-ready branch. Trigger phrases: "work on issue #N", "handle issue #N", "pick up #N", "let's do the next issue", "implement issue N".
---

# Handle Issue

Drive a single GitHub issue through this repo's SDLC (`docs/SDLC.md`) end to end: validate it's actually ready to build, design it on paper if it needs that, implement the smallest correct change, test it proportional to risk, and hand back a PR that satisfies the Definition of Done — without skipping a gate and without gold-plating past what the issue asked for.

This skill is the operational twin of `docs/SDLC.md`. That doc is the reference; this skill is the checklist you actually execute. If the two ever disagree, `docs/SDLC.md` wins — re-read it and follow it, and flag the mismatch to the user instead of silently picking one.

## Inputs

The user gives you one of:

- An issue number (`#N` or `N`) — the common case.
- A description of work with no issue yet — create the issue first (Phase 0 below), then continue.
- "Next issue" / "what's up next" — list open issues in the earliest open milestone, ask which one (or take the lowest-numbered one if the user says to just pick).

Fetch the issue before doing anything else:

```
gh issue view <N> --repo <owner>/<repo> --json number,title,body,labels,milestone,state,assignees
```

If the issue is already closed, stop and tell the user — don't silently reopen or redo closed work.

## Phase 0 — Discovery and Scope Control (gate: size + MoSCoW label present)

Per `docs/SDLC.md` §2 Phase 0 and §11 "Change eligibility": **no issue proceeds to Design/Build without a size label (`size/xs|s|m|l`) and a MoSCoW label (`must-have|should-have|could-have`).**

1. Check the issue's labels for both. If either is missing:
   - Infer a size and MoSCoW tier yourself from the issue body and the project plan (`pokemon-monitor-plan---*.md`), state your reasoning to the user in one or two sentences, and apply the labels with `gh issue edit <N> --add-label "size/x,tier"`.
   - Do not silently proceed without labels — this is a hard gate, not a formality.
2. Check the issue against the plan's exclusion lists (plan §1 "What Makes It Too Complex", plan §16 "Won't-Have", plan closing section "What to Avoid Building Early": auth, multi-user, checkout automation, proxy rotation, CAPTCHA bypass, stealth plugins, a queue before it's needed, a plugin/adapter marketplace, real-time WebSockets). If the issue asks for any of these, **stop and ask the user** to confirm they want an explicit, written override — don't implement it quietly, and don't refuse silently either.
3. If the issue as written is vague ("improve the dashboard"), tighten it into a 3–5 line problem statement before continuing. Post it as an issue comment if you had to materially reinterpret the ask, so there's a record.
4. If no GitHub issue exists yet (user gave you a raw description), create one now with `gh issue create`, sized and labeled per the above, before writing any code.

## Phase 1 — Architecture and Design (gate: design note exists for M/L work)

Per `docs/SDLC.md` §2 Phase 1: required for anything M/L sized, any new adapter, any schema change, any new API route. Skip this phase entirely for XS/S changes that don't touch those — don't manufacture a design note for a one-line selector fix.

When required, work out and state (as an issue comment, not a separate file) before writing code:

- **New adapter:** which data-source tier applies, in priority order per plan §5 "Using APIs When Available" — Shopify `/products/{handle}.json` or similar JSON endpoint > embedded `__NEXT_DATA__`/JSON-LD > HTML scraping with `got`+`cheerio` > Playwright only as a last resort (plan §10 explicitly limits Playwright to a fallback). State which tier you're using and why the higher tiers don't apply.
- **Schema change:** draft the Prisma model delta, and state whether it's additive/backward-compatible or destructive. If destructive (drops/renames a column or table, narrows a type), you need a rollback script sketched now — this blocks merge later per §8, so don't discover it at PR time.
- **New API route:** note the route, request/response shape, and what currently consumes it.
- **Anything else M/L:** a short paragraph on the approach and the main alternative you're not taking, and why.

Watch for the two failure modes named in the doc: reaching for Playwright when `got`+`cheerio` would work, and designing a generic/plugin system for what's currently 2-3 concrete cases. If your design is trending toward either, stop and simplify before continuing.

## Phase 2 — Implementation

1. Confirm you're not on `main` or `develop` directly — check `git status` / `git branch --show-current`. If you are, branch first:
   - `feat/<scope>-<short-desc>` for features, `fix/<scope>-<short-desc>` for bugs, `chore/<scope>-<short-desc>` for process/tooling — branched from `develop` (or from `main` only for a true hotfix, see below). Scope matches the existing package naming (`adapters`, `worker`, `notifications`, `db`, `web`, `core`).
   - If mid-conversation the user already has uncommitted work on the current branch that isn't related to this issue, stop and ask before branching away from it — don't strand their work.
2. Implement the smallest change that satisfies the (possibly-tightened) issue, following the constraints already established in this codebase and restated in `docs/SDLC.md` §2 Phase 2 / plan §9 "Maintainability Guidelines":
   - Adapters never import from `packages/db`. They return data; callers persist it.
   - Adapters never throw from `checkProduct()` — always return a `StockResult`, using an error/`ERROR:`-prefixed availability string for failures.
   - Selector strings live in a `SELECTORS` constant at the top of the adapter file.
   - No hardcoded polling intervals — read from `Store.pollingInterval`.
   - Respect `robots.txt` and the per-domain `minIntervalMs` throttle for any adapter touching a new domain — this is a merge gate per `docs/SDLC.md` §7, not optional.
3. Commit in small, logically atomic units using Conventional Commits, matching the existing repo history exactly: `type(scope): description`, referencing the issue number, e.g. `feat(adapters): add WooCommerce adapter (#N)`. Types: `feat`, `fix`, `test`, `chore`, `refactor`, `docs`.
4. Update `.env.example` in the same set of commits if you introduced a new environment variable. This is a named gate in `docs/SDLC.md` §8 and §11 — don't defer it.
5. Don't add abstractions, config options, or generality the issue didn't ask for. A bug fix doesn't need a refactor riding along with it.

## Phase 3 — Verification and Testing (gate: tests proportional to risk, mandatory for adapters)

Per `docs/SDLC.md` §6, test what you touched, weighted by what's actually risky here — not by chasing coverage:

| You changed                                | You must add/update                                                                                                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `StoreAdapter` implementation            | An in-stock fixture test, an out-of-stock fixture test, **and** a network-error test asserting `checkProduct` returns an error result rather than throwing. No exceptions — this is the single hard-required test gate in the whole project. |
| Store HTML changed under you               | Refresh the fixture HTML from the live page, update selectors, keep the old fixture under a `legacy/` note per plan §13 "Regression Tests".                                                                                                  |
| Transition/debounce/cooldown/backoff logic | A unit test covering the specific transition or edge case (e.g. flapping avoidance, cooldown window boundary).                                                                                                                               |
| An API route under `apps/web/app/api/**`   | An integration test hitting the route against a test DB, asserting the persisted row/response shape.                                                                                                                                         |
| Dashboard UI                               | A Playwright E2E check only if this is release-bound work; not required per-PR unless the PR is UI-only.                                                                                                                                     |

Run the full local check before considering this phase done:

```
npm run typecheck && npm run build && npm run test
```

All three must be clean. This mirrors the CI gate defined in `docs/SDLC.md` §8 assumption #2 (issue #7, "add GitHub Actions workflow") — until that workflow exists, you are the CI. Don't skip steps because "it's just a small change."

## Phase 4 — Release Preparation / PR

Open the PR (don't merge it yourself — merge is the user's call per this repo's `git` safety norms) with a description built from the template in `docs/SDLC.md` §5:

```markdown
## What

## Why

## Design note

(paste Phase 1 output here if it applied; omit the section entirely if it didn't)

## Testing

- [ ] Unit tests added/updated
- [ ] Fixtures added/updated (adapter changes only)
- [ ] Manually verified locally

## Migration plan

(schema changes only — omit otherwise)

## Rollback plan

(schema or worker/web contract changes only — omit otherwise)
```

Before opening it, run the Definition of Done from `docs/SDLC.md` §11 as a literal checklist against your own diff:

- [ ] Tests added/updated and passing
- [ ] `.env.example` updated if new env vars were introduced
- [ ] No new secrets in the diff (scan your own changes — check for anything that looks like a token, key, or webhook URL before staging)
- [ ] Adapter changes: fixtures updated, respects `robots.txt` and `minIntervalMs`
- [ ] Schema changes: migration tested locally against a test DB, rollback plan documented in the PR
- [ ] PR references the issue (`Closes #N` or `Refs #N` — use `Closes` only if this PR fully resolves it)

If any box can't be checked honestly, fix it before opening the PR rather than opening it and noting the gap — the gate exists to be met, not narrated.

Push the branch and open the PR with `gh pr create`, base `develop` (or `main` for a hotfix — see below). Report back to the user with the PR URL and a one-line summary of what's still open (e.g., "needs a review pass on the migration" or "ready to merge").

## Hotfix shortcut

If the user frames this as a live production issue (worker down, notification storm, adapter silently broken in prod) rather than routine backlog work, use the compressed path from `docs/SDLC.md` §5 "Hotfix / urgent production issue flow" instead of the full phase sequence:

1. Confirm it's real first — check `/api/health`, `ErrorLog`, recent `StockCheck` rows. Don't assume code is at fault before checking whether it's the target store's site instead.
2. Branch `hotfix/<slug>` from `main`, not `develop`.
3. Fix plus the minimal regression test that would have caught it — skip Phase 0/1 ceremony, a one-line problem statement in the PR is enough.
4. PR base is `main`; note in the PR body that it also needs merging back into `develop` after.
5. Tell the user a postmortem is warranted within 24-48h if this caused a missed restock or >1h of downtime (`docs/SDLC.md` §4 postmortem template) — don't write the postmortem yourself unless asked, just flag that the bar was met.

## Guardrails throughout

- Never merge, never push directly to `main` or `develop`, never force-push — open a PR and stop. Merging is the user's call every time, matching this repo's existing git safety norms.
- If mid-implementation you discover the issue is actually larger than its size label suggests (an S turns out to need a schema change), stop, say so, and re-label it rather than quietly finishing an L-sized change under an S label.
- If you hit a design decision the issue doesn't resolve and the plan doesn't cover, ask the user — don't guess silently on anything that affects scope, schema, or the adapter allow-list in plan §10.
- One issue, one branch, one PR. Don't bundle unrelated fixes into the same branch because you noticed them along the way — log them as new issues instead (tag `tech-debt` if it's cleanup, not a bug).
