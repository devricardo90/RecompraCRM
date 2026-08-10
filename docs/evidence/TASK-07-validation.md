# TASK-07 — Sale and SaleItem Persistence Evidence

## Scope and baseline

- Task: `TASK-07 — Modelo de vendas`
- Mode: `CONTROLLED_AUTONOMOUS`
- Branch: `feat/TASK-07-sales-model`
- Baseline: `5ce2365179b0b9519bb7312fed3990543043493c`
- Baseline CI: Validate #50 / `31329344342` — `SUCCESS`
- Initial technical head: `693c4504a6799fefdb28e0fff70fe37c1c780495`
- Transactional-deletion fix head: `e1f4899f0425232dbc76c4236e654792f86e5835`
- Isolated-harness fix head: `940fce6fad7262aae7579a999c5fedb102a2233b`
- Sale.id immutability fix head: `c4bfbc40b73470ca4e919e3b098bf4a95b78c620`
- Sale-item-guard write-conflict fix head: `76c637cc9d31fb53acdc5ff492e1e2951dddeca6`
- Current validated head: `2f0bc7a8914219977710d7eaa821f2eb45abe773`
- Pull request: #11

The local SDD and the canonical Google Doc `Fonte da Verdade - Recompra CRM`
were read and reconciled before implementation. Both require a Sale associated
with a Customer and one or more SaleItems associated with Product, with
positive quantity. Stock reduction remains TASK-08 and repurchase calculation
remains TASK-09.

## Implemented model

- `Sale`: `id`, `customerId`, `soldAt`, `status`, optional `notes`,
  `createdAt`, `updatedAt` and the Customer/items relations.
- `SaleItem`: `id`, `saleId`, `productId`, positive `quantity`, optional
  `unitPrice`, nullable `expectedRepurchaseAt` and the Sale/Product relations.
- Foreign keys use `RESTRICT` on delete so Customer, Product and Sale history
  cannot be removed before TASK-08 defines stock-restoration behavior.
- A deferred PostgreSQL constraint trigger permits atomic nested creation while
  preventing any committed Sale from existing without at least one item.
- A `BEFORE DELETE` trigger blocks Sale deletion even when every SaleItem is
  removed earlier in the same transaction.
- A `BEFORE UPDATE OF "id"` trigger makes `Sale.id` immutable, closing a gap
  where a mid-transaction primary-key change could let the deferred item
  check validate under a stale id.
- `ensure_sale_has_items()` performs a real `UPDATE` on the Sale row (instead
  of `SELECT ... FOR UPDATE`) so PostgreSQL raises a serialization failure for
  whichever of two concurrent `REPEATABLE READ` transactions removing
  different items from the same Sale reaches commit second, instead of both
  silently succeeding under their own stale snapshots.
- No stock mutation, repurchase formula, Sale API or Sale UI was implemented.

## Deterministic validation

An isolated PostgreSQL 16 instance used Compose project `recompra-task07` on
port 55433. No external container was changed. The isolated container, network
and volume were removed after validation.

- `npm install --no-audit --no-fund`: PASS
- `npm run db:generate`: PASS
- `npm run db:validate`: PASS with the isolated local URL
- database recreation from an empty volume: PASS
- `npm run db:migrate`: PASS; all eight migrations applied in order
- `npm run db:health`: PASS
- `npm run test:migration-compat`: PASS for clean and legacy scenarios
- `npm test`: PASS for Customer, Product and Sale persistence
- `npm run test:sale`: PASS after the final harness assertions
- `npm run lint`: PASS
- `npm run typecheck`: PASS after regenerating the disposable `.next` output
- `npm run build`: PASS
- `git diff --check`: PASS
- secret scan: PASS; only pre-existing CI-only PostgreSQL example credentials
  were detected outside the changed hunks
- Playwright: `NOT_REQUIRED_NO_UI_CHANGE`

The Sale harness proves a valid two-item Sale, relation hydration, optional
price/null fields, timestamps and PostgreSQL persistence. It also proves that
zero/negative quantities, missing Customer/Product relations, a Sale without
items, deleting every item, deleting referenced Customer/Product records and
deleting a Sale before a restoration policy are rejected.

## GitHub Actions

Validate #51 / run `31330995290` — `SUCCESS` for
`693c4504a6799fefdb28e0fff70fe37c1c780495`.

The run passed migration deploy, database health, migration compatibility,
Customer/Product/Sale persistence, Customer/Product API integration, lint,
typecheck and build against PostgreSQL 16.

Codex reviewed `50eeff525423aaf50baca158522f0c0b895e8f28` and found that a
transaction could remove all items before deleting the parent Sale. The P2 was
fixed in `e1f4899f0425232dbc76c4236e654792f86e5835`; the harness now executes
that exact sequence and proves rejection.

Validate #53 / run `31332166675` — `SUCCESS` for
`e1f4899f0425232dbc76c4236e654792f86e5835`.

Codex then found that the deletion block prevented the former fixture cleanup
on persistent local databases. The harness now creates a unique PostgreSQL
schema, applies the real migration chain there and drops the entire schema in
`finally`. Two consecutive local runs passed and a catalog query returned zero
remaining `sale_model_check_%` schemas.

Validate #55 / run `31390596504` — `SUCCESS` for
`940fce6fad7262aae7579a999c5fedb102a2233b`.

Codex reviewed `940fce6fad7262aae7579a999c5fedb102a2233b` and found that a
transaction could change `Sale.id` before COMMIT, letting the deferred
"at least one item" trigger validate under the stale id while the renamed
row reached COMMIT without any SaleItem. Fixed in
`c4bfbc40b73470ca4e919e3b098bf4a95b78c620` with a
`BEFORE UPDATE OF "id"` trigger that rejects the change immediately; the
harness gained a case proving the rejection and another proving a normal
non-id field update still succeeds.

Validate #58 / run `31403871488` — `SUCCESS` for
`c4bfbc40b73470ca4e919e3b098bf4a95b78c620`.

The next Codex review found two more P2s: (1) `ensure_sale_has_items()`'s
`SELECT ... FOR UPDATE` never writes to the Sale row, so under
`REPEATABLE READ` two transactions each deleting a different item from the
same two-item Sale could both pass the check against their own
transaction-start snapshot and both commit, leaving the Sale itemless; and
(2) STATE.md/HANDOFF.md were left pointing at the pre-fix head. (1) was fixed
in `76c637cc9d31fb53acdc5ff492e1e2951dddeca6` by replacing the read-only lock
with a real `UPDATE`, which makes PostgreSQL raise a serialization failure
(`40001`) for the second transaction to reach commit; the harness gained a
case running two concurrent `RepeatableRead` transactions and asserting
exactly one is rejected with at least one item surviving, stable across
repeated local runs. (2) was fixed in the following docs-only commits, which
also corrected a duplicated TASK-07 record further down HANDOFF.md's front
matter and the equivalent stale record in `docs/roadmap/ROADMAP.md` that
later review rounds surfaced.

Validate #59 / run `31408117992` — `SUCCESS` for
`76c637cc9d31fb53acdc5ff492e1e2951dddeca6`.

Validate #61 / run `31409131924` — `SUCCESS` for
`2f0bc7a8914219977710d7eaa821f2eb45abe773`.

## Status

TASK-07 is technically verified green after four correction rounds (the
original transactional-deletion and isolated-harness fixes, plus the
Sale.id-immutability and write-skew recovery fixes) and awaits a clean final
independent Codex review. TASK-08 has not been started.
