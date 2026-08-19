# TASK-09 — Repurchase Forecast Evidence

## Scope and baseline

- Task: `TASK-09 — Previsão de recompra`
- Mode: `CONTROLLED_AUTONOMOUS`
- Loop: `RICK_LOOP_V1_3`
- Branch: `feat/TASK-09-repurchase-forecast`
- Spec: `docs/specs/TASK-09.md`
- Pull request: #14
- Initial implementation head: `626953c` (compute forecast per SaleItem)
- Review round 1 fixes: `87904a3`, `e497162`, `3344d6a`
- Review round 2 fixes (legacy backfill + lock upgrade P1s): `a352de7`
- Review round 3 fix (lock-order P1s): `e7cfff0`
- Review round 4 fix (cross-sale share lock P2): `7b78b92`
- Review round 5 fix (stale REPEATABLE READ snapshot P2): `f89e225`
- Review round 6 fix (write vs delete lock order P1): `2d004f4`
- Review round 7 fix (old product on reassignment P1): this head

Canonical rule covered:
`expectedRepurchaseAt = Sale.soldAt + SaleItem.quantity × Product.consumptionDays days`,
independently per item of a multi-product sale. Scope stays at the persistence
layer — the sale registration UI is TASK-10.

## Review round 3 — two P1 lock-order findings

The independent review of `e3be67a` reported two blocking findings, both real
deadlock cycles introduced by TASK-09's propagation triggers meeting the
child→parent writes that TASK-07 and TASK-08 already depended on:

| Finding | Cycle |
| --- | --- |
| Use one lock order for product forecast propagation | `Product → SaleItem` (consumptionDays propagation) vs `SaleItem → Product` (forecast read + TASK-08 stock reconciliation) |
| Avoid reversing Sale and SaleItem locks | `Sale → SaleItem` (soldAt propagation) vs `SaleItem → Sale` (forecast read + TASK-07 "at least one item" guard) |

Each pair locks the same two tables in opposite order, so once the two
operations overlap PostgreSQL aborts one of them with `40P01`.

### Why reordering row locks could not fix it

In both cycles the parent row is already locked by the very statement whose
`AFTER` trigger performs the propagation, and the child row is already locked
by the statement whose `BEFORE` trigger reads the parent. Neither side has a
point left at which it could take its locks in the other order. The
child→parent direction is also not removable: it is what TASK-07's guard and
TASK-08's stock reconciliation are built on.

### Fix

`prisma/migrations/20260819140000_serialize_forecast_lock_order` stops the two
*directions* from overlapping while keeping writers of the same direction
concurrent. A statement-level `BEFORE` trigger runs before its statement locks
any row, which is the only remaining point that precedes every row lock, so
both directions take one transaction-scoped advisory lock there in different
modes:

- SaleItem `INSERT`/`UPDATE`/`DELETE` take it **shared** — they stay concurrent
  with each other exactly as before, still arbitrated by the row locks and MVCC
  conflicts TASK-07 and TASK-08 rely on.
- `UPDATE OF "soldAt"` on Sale and `UPDATE OF "consumptionDays"` on Product take
  it **exclusive** — while one runs, no SaleItem write is inside the cluster.

Only `UPDATE OF` the propagating column arms the exclusive lock. This is load
bearing: TASK-08's stock reconciliation updates `Product.currentStock` and
TASK-07's guard updates `Sale.updatedAt` from *inside* the child direction, and
neither may try to upgrade the shared lock it already holds. Because neither
statement names `consumptionDays` or `soldAt`, neither exclusive trigger fires.

An earlier attempt used a single exclusive lock for every statement in the
cluster. It removed the deadlocks but serialized whole transactions, which
deadlocked the TASK-07 harness case where two transactions must both delete an
item before either commits. That is why the shared/exclusive split, not a plain
mutex, is the shipped design.

Residual, deliberately not covered: a single transaction that both writes a
SaleItem and updates `consumptionDays`/`soldAt` would request the exclusive lock
while holding the shared one. Two such transactions racing would be aborted by
PostgreSQL as a normal, retryable deadlock rather than corrupting anything. No
application path performs that combination — the product and sale routes are
separate transactions.

## Review round 4 — cross-sale move P2

The review of `e7cfff0` confirmed both round-3 P1s as resolved and reported one
new P2. `SaleItem.saleId` is mutable and moving an item between sales is legal
whenever the source keeps another item, so two transactions can move items in
opposite directions between two multi-item sales. Both are the child direction,
so the shared gate admits both — correctly. But each one's forecast trigger took
`FOR SHARE` on its *destination* Sale, while the deferred
`SaleItem_preserves_sale_items` guard updates its *source* Sale at COMMIT. The
A→B transaction therefore held a share lock on B and needed to update A, and the
B→A transaction the mirror image; each share lock blocked the other's update.

The fix drops that share lock
(`prisma/migrations/20260819160000_drop_redundant_sale_share_lock`). It was
added so a forecast read would conflict with a concurrent `soldAt` correction,
and since the round-3 migration such a correction takes the cluster lock
exclusively while every SaleItem write holds it shared — the two can no longer
overlap at all. Removing it deletes the cycle without weakening the guarantee
that motivated it.

`Product` deliberately stays on `FOR NO KEY UPDATE`: that lock is not about
concurrent `consumptionDays` changes but about stopping two SaleItem writes for
the same product from deadlocking while upgrading to TASK-08's stock `UPDATE`.
Both are the child direction and run concurrently by design.

## Review round 5 — stale REPEATABLE READ snapshot P2

The review of `7b78b92` confirmed the round-4 P2 as resolved and reported one
more. A `REPEATABLE READ` transaction takes its snapshot; a `soldAt` correction
then commits; the transaction afterwards inserts an item into that sale, and the
plain read serves the pre-correction date from its own snapshot — so the item
commits a forecast against a superseded sale date. The advisory gate cannot help
here: the correction is already committed, so there is no overlap in time to
exclude. The parent's propagation cannot repair the row either, because it was
not attached to the sale when the propagation ran. Nothing would ever correct it.

Only a row lock conflicting with a non-key `UPDATE` rejects that writer, by
making PostgreSQL raise `40001`. Two candidate modes were ruled out empirically
rather than by argument:

- **`FOR KEY SHARE`**, the mode the review proposed, is not sufficient.
  Correcting `soldAt` is a non-key update, so KEY SHARE does not conflict with
  it; PostgreSQL locks the newer version without raising anything and the stale
  snapshot is still served. The harness caught this immediately — the fix was
  tried and the post-fix assertion failed against a real database.
- **`FOR SHARE`** is exactly what round 4 had to remove.

What reconciles both rounds is not a weaker lock but a fixed lock order
(`prisma/migrations/20260819180000_order_sale_locks_for_forecast`). A move
touches two sale rows — the destination it reads and the source the deferred
guard updates — so the trigger locks both with `FOR NO KEY UPDATE`, lowest id
first. Opposite-direction moves request the same rows in the same order and one
waits instead of deadlocking. Every other case touches a single sale.

The trigger fires only on INSERT and on `UPDATE OF quantity/productId/saleId`,
never on DELETE, so TASK-07's concurrent removal of two items of one sale keeps
arbitrating through that guard's own update rather than through this lock.

## Review round 6 — write vs delete lock order P1

The review of `f89e225` confirmed the round-5 P2 as resolved and reported that
round-5's own ordering created a new cycle. Locking Sale before reading Product
put `Sale → Product` in the write path, while the delete path already ran
`Product → Sale`:

| Path | Order |
| --- | --- |
| forecast write (insert / quantity update) | locks `Sale`, then reads `Product` `FOR NO KEY UPDATE` |
| item delete | `SaleItem_restores_product_stock_on_delete` updates `Product` at once; `SaleItem_preserves_sale_items` updates `Sale` at COMMIT |

So an insert or quantity update racing the deletion of another item of the same
sale and product deadlocked. Both are legal whenever the sale retains an item,
and both are the child direction, so the shared gate admits them together by
design.

The delete path cannot be reordered — its Product update is an `AFTER DELETE`
trigger and its Sale update is a deferred constraint trigger, both fixed by
construction. `Product` before `Sale` is therefore the only order the two paths
can share, and
`prisma/migrations/20260819200000_lock_product_before_sale_for_forecast` adopts
it. Round 5's other two properties are untouched: the sales are still locked
`FOR NO KEY UPDATE`, which is what rejects a stale `REPEATABLE READ` writer, and
a move still locks source and destination lowest id first. The child direction
now has one global order — `Product`, then `Sale` by ascending id.

The parent direction still locks in the opposite order in places, but it holds
the cluster's advisory lock exclusively, so no child path can be inside at the
same time and no cycle with it can form.

## Review round 7 — old product on reassignment P1

The review of `2d004f4` confirmed the round-6 P1 as resolved and reported that
one supported mutation still reversed the order. Round 6 locked only
`NEW."productId"`, but TASK-08's `reconcile_product_stock_on_sale_item_update`
updates *both* products on a `productId` change — restoring stock to the old one
and charging the new one — so a reassignment reached the old product only after
the Sale:

| Path | Order |
| --- | --- |
| reassignment | locks new `Product`, then `Sale`, then waits for the old `Product` in the AFTER stock trigger |
| item delete | holds the old `Product` from the restore trigger, then waits for `Sale` in the deferred guard at COMMIT |

Deleting another item of the same sale and old product is legal whenever the
sale retains an item, and both are the child direction, so the shared gate
admits them together and one was aborted with `40P01`.

`prisma/migrations/20260819220000_lock_both_products_before_sale` locks every
Product the statement can touch, lowest id first, before any Sale. That
completes the child direction's global lock order:

> every `Product` this statement will touch, by ascending id, then every `Sale`
> it will touch, by ascending id.

Two concurrent reassignments sharing a product request it in the same relative
order, and the delete path — one product, then one sale — is a prefix of that
order. All earlier properties are preserved: the sale rows are still locked
`FOR NO KEY UPDATE`, which rejects a stale `REPEATABLE READ` writer, and a move
across sales still locks both sale rows lowest id first.

## Deterministic validation

`scripts/sale-forecast-lock-order-check.mjs`, wired into
`npm run test:repurchase-forecast` and therefore into Validate, proves the
defect and the fix on a real database rather than arguing about them:

1. builds a database from every migration *preceding* the round-3 fix and
   reproduces both P1 cycles, requiring PostgreSQL to abort one side;
2. advances that same database to the round-3 head exactly and reproduces the
   cross-sale P2 the shared gate correctly let through;
3. advances it to the round-4 head exactly and proves the stale
   `REPEATABLE READ` writer commits a forecast against the superseded `soldAt`;
4. advances it to the round-5 head exactly and reproduces the write-vs-delete
   cycle that round-5's ordering created;
5. advances it to the round-6 head exactly and reproduces the
   reassignment-vs-delete cycle through the old product;
6. deploys the full chain over that same populated database;
7. requires every one of those interleavings to behave correctly — the moves
   and updates committing with the forecasts and stock the canonical formula
   demands, and the stale writer rejected with a serialization failure that
   leaves no row behind.

The racing insert is issued as raw SQL so the PostgreSQL SQLSTATE survives: the
typed client collapses `40001` and `40P01` into one generic write-conflict
error, and this case must assert a serialization failure specifically.

The parent operations are single statements — the shapes the review actually
described (a product `PUT` changing `consumptionDays`, a correction of
`Sale.soldAt`). The window between "the parent row is locked" and "the parent
updates the items" cannot be hit by timing alone, so a third transaction pins
one affected item with a plain `SELECT … FOR UPDATE`, holding the parent inside
exactly that window. That statement fires no triggers, so it never enters the
cluster and can never itself be part of a cycle. Every step advances on a
`pg_stat_activity` lock-wait condition, never on a sleep.

Assertions after the fixed runs:

- product cycle: propagated item = `soldAt + 7 days`, updated item =
  `soldAt + 14 days`, stock `97`;
- sale cycle: propagated item = corrected `soldAt + 5 days`, updated item =
  corrected `soldAt + 15 days`, stock `97`;
- cross-sale moves: each moved item lands on its destination sale with a
  forecast recomputed against that sale's `soldAt`;
- stale writer: rejected with `40001`, no SaleItem persisted;
- write vs delete: written item = `soldAt + 10 days`, stock `98` after both
  the restoration and the quantity change;
- reassignment vs delete: item re-forecast against its new product
  (`soldAt + 9 days`), old product back to `100`, new product `99`.

## Local gate results

Local PostgreSQL (docker compose, isolated schema per harness):

| Gate | Result |
| --- | --- |
| `db:migrate` (20 migrations) | PASS |
| `db:health` | PASS |
| `test:migration-compat` (clean + legacy) | PASS |
| `test:customer` | PASS |
| `test:product` | PASS |
| `test:sale` (TASK-07 concurrency) | PASS |
| `test:sale-stock` | PASS |
| `test:repurchase-forecast` (forecast + recovery + lock-order) | PASS |
| `test:product-api` | PASS |
| `test:customer-api` | PASS |
| `test:loop-controller` | PASS |
| `lint` | PASS |
| `typecheck` | PASS |
| `build` | PASS |

The lock-order harness was run repeatedly to confirm the interleaving is
reproducible rather than timing-dependent.

Playwright ephemeral: not applicable — TASK-09 changes no UI. The sale
registration interface and its mobile-first Playwright run belong to TASK-10.
