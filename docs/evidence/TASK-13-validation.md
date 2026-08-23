# TASK-13 — Stock Dashboard Evidence

## Scope and checkpoint

- Task: `TASK-13 — Dashboard de estoque`
- Mode: `CONTROLLED_AUTONOMOUS`
- Loop: `RICK_LOOP_V1_3_2`
- Branch: `feat/TASK-13-stock-dashboard`
- Baseline: `2995589c88ea7ab46781b59ba273b440eb2eebdd` (`main`)
- Spec: `docs/specs/TASK-13.md`
- Technical commit: `fc75538` (`feat(TASK-13): add stock alert dashboard`)
- PR: `#20` — open, currently being extended from spec-only to implementation

The recovered worktree contained the implementation in progress. It was
validated in place and committed without staging the pre-existing untracked
`.claude/settings.local.json`.

## Implemented behavior

- `/inventory` reads current `GET /api/products` data with `cache: "no-store"`.
- Alerts use the shared `isLowStock` predicate: `currentStock <= minimumStock`.
- Alert ordering is deterministic by deficit ascending, then `id` ascending.
- The dashboard exposes alert count, the canonical criterion, product name,
  unit, current stock, minimum stock and a textual low-stock indicator.
- Loading, error/retry, zero-alert and populated states are distinct.
- `/`, `/products` and `/sales` expose the `Estoque` destination.
- No schema, migration, sale writer or stock mutation was added.

## Deterministic validation

| Gate | Result |
| --- | --- |
| `db:migrate` (22 migrations) | PASS — no pending migrations |
| `db:health` | PASS |
| `npm test` | PASS — Customer, Product, stock alerts, source/schema boundaries, Sale, stock transaction, forecast, sale registration and history |
| `test:migration-compat` | PASS — clean and legacy scenarios |
| `test:product-api` | PASS |
| `test:customer-api` | PASS |
| `test:loop-controller` | PASS |
| `db:generate` / `db:validate` | PASS |
| `lint` / `typecheck` / `build` | PASS |
| `git diff --check` | PASS |
| secret scan | PASS — no matching credential material |
| schema scope gate | PASS — no `prisma/schema.prisma` or `prisma/migrations/` change |
| source boundary gate | PASS — shared helper and read-only dashboard |

The API integration harnesses required elevated execution because the local
Next/Turbopack watcher cannot inspect the parent directory from the sandbox;
the harness assertions themselves passed.

## Playwright — ephemeral

12 scenarios, retries `0`, PASS. The temporary scenario and server artifacts
were removed after the run per `docs/operations/PLAYWRIGHT-EPHEMERAL.md`.

Covered: desktop urgency order and equal-deficit ID tie-break; alert content;
mobile, landscape and desktop overflow; empty state; controlled error/retry;
observable loading without a false empty state; runtime GET-only API access;
landmarks, visible focus and 44px touch targets; navigation into `/inventory`
from `/`, `/products` and `/sales`; `/products` low-stock regression at the
equality boundary; and sale confirmation followed by the next dashboard read
showing the reduced stock as an alert.

## Review and handoff

Local independent review of `fc75538` found no blocking issue. Remote PR #20
still needs exact-head review, CI for the implementation commit, merge and
post-merge validation before TASK-13 can be marked `VERIFIED_GREEN`.
