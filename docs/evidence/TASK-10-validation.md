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

**A — deterministic mutation shape.** `lib/sales/registerSale.ts` is the only
authorized writer of `Sale`/`SaleItem`. It opens one interactive transaction,
creates the `Sale` without nested items, sorts items by ascending `productId`,
and inserts **one `SaleItem` per statement** in a loop — never `createMany` or a
nested `create`, both of which emit the multi-row statement TASK-09's residual is
about. The ascending order matches the order the forecast trigger locks `Product`
rows in. Duplicate product selections are summed into a single item before
persistence, so one transaction never holds two items contending for the same
`Product`. The API route validates and delegates; it never assembles a write.

**B — bounded retry.** Three attempts total, retrying only `40P01` and `40001`,
redoing the whole transaction from scratch each time, with a bounded jitter-free
20 ms / 40 ms backoff. Exhaustion raises `SaleConcurrencyError` → HTTP 503 with a
readable message; the original SQLSTATE is preserved.

Domain invariants (`23514` CHECK, `23503` FK) are deliberately **not** retried —
they are deterministic answers, map to HTTP 409, and retrying would repeat the
same failure three times and hide the cause.

## Concurrency harness

`scripts/sale-registration-concurrency-check.mjs`
(`npm run test:sale-registration`, wired into `npm test` and into Validate),
isolated PostgreSQL schema per run, real database throughout.

| # | Case | Assertion |
| --- | --- | --- |
| 1 | multi-item sale, unsorted input with a duplicate | 3 items persisted in ascending `productId`, duplicate quantities summed, stock `47`, forecast = `soldAt + 12 days` |
| 1 | emitted shape | exactly **one** `INSERT INTO "SaleItem"` statement per item, read from Prisma's `query` events |
| 2 | two concurrent sales sharing both products, opposite input order | both commit; stock `17` and `16` |
| 3 | real forced deadlock against a concurrent item deletion | recovers; exactly one sale for that product |
| 3b | attempt 1 always `40P01`, attempt 2 succeeds | succeeds on attempt 2, **exactly one** sale, stock charged once |
| 4 | insufficient stock | fails on attempt 1 (not retried), stock unchanged, no itemless `Sale` |
| 5 | every attempt raises `40P01` | `SaleConcurrencyError` after exactly 3 attempts, SQLSTATE preserved, no itemless `Sale` |
| 6 | whole run | no product ended with negative stock |

Case 1 is what prevents a silent regression: replacing the loop with
`createMany` collapses the insert count to one and fails the test.

Synchronization uses `pg_stat_activity` lock-wait polling, not `sleep`. Three
consecutive local runs passed.

Two harness defects were found and fixed while building it, both mine: hooks
initially issued queries on the pooled client while the transaction held its only
connection, and a stray release freed the concurrent deleter before the writer
had taken its lock, so no cycle could form.

## Playwright — ephemeral

Scenario built in `.rick/tmp/playwright/task10/`, `retries: 0` so nothing flaky
is masked. **11 passed in 31.6 s**, then test, config, traces, screenshots and
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
