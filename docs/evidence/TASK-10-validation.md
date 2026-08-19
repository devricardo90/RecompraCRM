# TASK-10 — Sale Registration Evidence

## Scope and baseline

- Task: `TASK-10 — Interface de registro de venda`
- Mode: `CONTROLLED_AUTONOMOUS`
- Loop: `RICK_LOOP_V1_3` (amendment v1.3.1)
- Branch: `feat/TASK-10-sale-registration-ui`
- Baseline: `7bf2dd0df9c873576bdb17c81c92e819f4587822` (main)
- Spec: `docs/specs/TASK-10.md`

## Concurrency strategy — decided before implementation

The spec was amended and committed **before** any product code existed, as its
own contract required. Both strategies were adopted.

**A — deterministic mutation shape.** `lib/sales/saleTransaction.ts` holds the
whole policy and `lib/sales/registerSale.ts` binds the application's Prisma
client to it; together they are the only authorized writer of `Sale`/`SaleItem`.
It opens one interactive transaction,
creates the `Sale` without nested items, sorts items by ascending `productId`,
and inserts **one `SaleItem` per statement** in a loop — never `createMany` or a
nested `create`, both of which emit the multi-row statement TASK-09's residual is
about. The ascending order matches the order the forecast trigger locks `Product`
rows in. Duplicate product selections are summed into a single item before
persistence, so one transaction never holds two items contending for the same
`Product`. The API route validates and delegates; it never assembles a write.

**B — bounded retry.** Three attempts total, retrying `40P01`, `40001` and
Prisma's normalized `P2034`, redoing the whole transaction from scratch each
time, with a bounded jitter-free 20 ms / 40 ms backoff. Exhaustion raises
`SaleConcurrencyError` → HTTP 503 with a readable message; the original state is
preserved.

Domain invariants (`23514` CHECK, `23503` FK, and Prisma's `P2003`) are
deliberately **not** retried — they are deterministic answers, map to HTTP 409,
and retrying would repeat the same failure three times and hide the cause.

## Review round 1 — five findings, all confirmed and fixed

The review of `792a0ea` reported two P1s and three P2s. All were real.

**P1 — retry was silently disabled for typed writes.** Prisma collapses a real
`40P01`/`40001` raised by `tx.saleItem.create` into `P2034` and drops the
SQLSTATE, so `sqlStateOf` returned `null` and the transaction was rethrown after
attempt 1 instead of following the three-attempt policy. Galling because the
TASK-09 harness already documents that collapse — I wrote the note and then did
not apply it. `classifySaleError` now treats `P2034` as retryable.

**P1 — the harness tested a copy, not production.** Every case called a private
reimplementation of the registrar, so switching production to `createMany`,
dropping normalization, or breaking retry classification would have left it
green, which is exactly why the `P2034` gap survived. Policy moved to
`lib/sales/saleTransaction.ts`, which imports no Prisma singleton and no path
alias so the harness can import and drive it directly under Node's native type
stripping. `lib/sales/registerSale.ts` is now a thin wrapper binding the app
client.

Verified the guard actually bites: temporarily replacing the loop with
`createMany` fails the harness with *"expected one INSERT statement per item,
observed 1"*, and restoring it passes.

**P2 — sorted read-back proved nothing.** `persistedOrder` was read with
`orderBy: { productId: "asc" }`, so it looked ascending regardless of write
order. The harness now reconstructs the **actual** write sequence from the
statement parameters of each `INSERT`, matching each statement to its product by
a (productId, quantity) pair chosen so the values cannot collide with
autoincrement ids.

**P2 — `P2003` was not mapped.** A product deleted after the catalog loaded
produced a generic 503 instead of the contracted 409. Now classified as a domain
invariant.

**P2 — duplicate totals could overflow.** Two lines can each pass the per-line
`2147483647` limit while their sum does not. `normalizeSaleItems` now validates
each aggregate with `Number.isSafeInteger` and the PostgreSQL maximum before the
transaction opens, returning 400.

## Concurrency harness

`scripts/sale-registration-concurrency-check.mjs`
(`npm run test:sale-registration`, wired into `npm test` and into Validate),
isolated PostgreSQL schema per run, real database throughout.

| # | Case | Assertion |
| --- | --- | --- |
| 0 | error classification | `P2034` and raw `40P01`/`40001` ⇒ retryable; `P2003` and `23514` ⇒ invariant; anything else ⇒ fatal |
| 0 | aggregate overflow | duplicate total above the INTEGER range raises `SaleValidationError` before any transaction |
| 1 | multi-item sale, unsorted input with a duplicate | 3 items, duplicate quantities summed, stock and forecast from the canonical formula |
| 1 | emitted shape | exactly **one** `INSERT INTO "SaleItem"` per item, and the **actual write order** reconstructed from statement parameters is ascending `productId` |
| 2 | two concurrent sales sharing both products, opposite input order | both commit; stock `17` and `16` |
| 3 | real forced deadlock against a concurrent item deletion | recovers; exactly one sale for that product |
| 3b | attempt 1 always `40P01`, attempt 2 succeeds | succeeds on attempt 2, **exactly one** sale, stock charged once |
| 4 | insufficient stock | `SaleInvariantError` on attempt 1 (not retried), stock unchanged |
| 4 | missing product | `SaleInvariantError`, not a generic failure |
| 5 | every attempt raises `40P01` | `SaleConcurrencyError` after exactly 3 attempts, SQLSTATE preserved, no itemless `Sale` |
| 6 | whole run | no product ended with negative stock |

Cases 0 and 1 are what prevent a silent regression, and they run against the
production module rather than a copy of it.

Synchronization uses `pg_stat_activity` lock-wait polling, not `sleep`. Three
consecutive local runs passed.

Two harness defects were found and fixed while building it, both mine: hooks
initially issued queries on the pooled client while the transaction held its only
connection, and a stray release freed the concurrent deleter before the writer
had taken its lock, so no cycle could form.

## Playwright — ephemeral

Scenario built in `.rick/tmp/playwright/task10/`, `retries: 0` so nothing flaky
is masked. **11 passed**, re-run after the round-1 refactor (13.1 s), then test, config, traces, screenshots and
report were removed per `docs/operations/PLAYWRIGHT-EPHEMERAL.md`.
`@playwright/test` was installed with `--no-save`, so the dependency surface is
unchanged.

| Viewport | Scenario | Result |
| --- | --- | --- |
| mobile 390×844 | multi-item sale: stock `8`/`7` and both forecasts rendered as dates | PASS |
| mobile | add/remove item rows; last row cannot be removed | PASS |
| mobile | insufficient stock reported, nothing registered | PASS |
| mobile | invalid quantity rejected before submit | PASS |
| mobile | missing customer reported | PASS |
| mobile | API failure surfaces a readable error | PASS |
| mobile | retry-exhaustion message reaches the user | PASS |
| mobile | submit disables while saving; double click ⇒ **1** POST and **1** sale | PASS |
| mobile | empty state guides when the catalog is empty | PASS |
| mobile | catalog load failure shows error + retry | PASS |
| desktop 1280×900 | flow sanity and navigation between screens | PASS |

One test defect was fixed during the run: an unscoped `getByRole("alert")` was
ambiguous because Next.js keeps a route announcer with the same role. The
application markup was correct; the assertion was not.

## Local gate results

| Gate | Result |
| --- | --- |
| `db:migrate` (21 migrations) | PASS |
| `test:migration-compat` | PASS |
| `test:customer` / `test:product` / `test:sale` / `test:sale-stock` | PASS |
| `test:repurchase-forecast` (3 harnesses) | PASS |
| `test:sale-registration` | PASS |
| `test:product-api` / `test:customer-api` | PASS |
| `test:loop-controller` | PASS |
| `lint` / `typecheck` / `build` | PASS |
| Playwright ephemeral | PASS (11) |

## Inherited invariants respected

`expectedRepurchaseAt` is never sent or computed by the application — the API
rejects it outright rather than ignoring it, and the harness asserts the value
comes from the database. Stock, non-negativity, positive quantity and
"at least one item" remain enforced by TASK-07/08/09 triggers; TASK-10 only
reports them.
