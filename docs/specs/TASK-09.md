# TASK-09 Spec — Previsão de recompra

Status: IMPLEMENTED_VALIDATED_WAITING_REVIEW
Source: `docs/product/PROJECT-SDD.md` + `docs/roadmap/ROADMAP.md`
Depends on: TASK-08
PR: #14
Last independently reviewed HEAD: `e7cfff0980954bab06db5da5ebe98e0050083904` (round-3 P1s cleared, one new P2)
Current technical HEAD: pending push of the round-4 share-lock fix
Validation: Validate `32263724994` SUCCESS on `e7cfff0`; round-4 head revalidated below

## Outcome

Persist a per-SaleItem initial repurchase forecast using the canonical formula:

`expectedRepurchaseAt = Sale.soldAt + SaleItem.quantity × Product.consumptionDays days`

A multi-product sale has an independent forecast for each item.

## In scope

- deterministic persistence-layer computation;
- recomputation when quantity/product/sale date/consumption duration changes;
- backfill of historical SaleItems where the forecast is representable by the application DateTime range;
- concurrency correctness with TASK-08 stock updates;
- deterministic PostgreSQL-backed tests.

## Out of scope

- sale registration UI (TASK-10);
- customer history UI (TASK-11);
- repurchase dashboard (TASK-12);
- predictive AI or messaging.

## Recovery policy for round-4 review finding (cross-sale moves)

The review of `e7cfff0` confirmed both round-3 P1s as resolved and reported one
P2: two transactions moving items in opposite directions between two
multi-item sales (A -> B and B -> A) still deadlocked. Both are the child
direction, so the shared gate admits both by design; each then took `FOR SHARE`
on its *destination* Sale while the deferred TASK-07 guard updates its *source*
Sale at COMMIT, so each share lock blocked the other's update.

1. The Sale `FOR SHARE` is dropped. It existed so a forecast read would
   conflict with a concurrent `soldAt` correction, and since the round-3
   migration such a correction takes the cluster lock in EXCLUSIVE mode while
   every SaleItem write holds it SHARED - the two can no longer overlap at
   all, so the row-level share lock only contributed the edge above.
2. `Product` stays on `FOR NO KEY UPDATE`. That lock is not about concurrent
   `consumptionDays` changes; it is what stops two SaleItem writes for the same
   product from deadlocking while upgrading to TASK-08's stock `UPDATE`. Both
   are the child direction and run concurrently by design, so it is still
   required.

## Recovery policy for round-3 review findings (lock order)

The independent review of `e3be67a` reported two P1 deadlock cycles:
`Product <-> SaleItem` (consumptionDays propagation against the forecast read
plus TASK-08 stock reconciliation) and `Sale <-> SaleItem` (soldAt propagation
against the forecast read plus the TASK-07 "at least one item" guard).

1. Row locks cannot be reordered out of either cycle: the parent row is
   already held by the statement whose AFTER trigger propagates, and the child
   row by the statement whose BEFORE trigger reads the parent. The
   child->parent direction is what TASK-07 and TASK-08 are built on and stays.
2. The two directions instead take one transaction-scoped advisory lock in a
   statement-level BEFORE trigger, which is the only point preceding every row
   lock. SaleItem writes take it shared, so same-direction concurrency is
   unchanged; the two propagating parent statements take it exclusive.
3. Only `UPDATE OF` the propagating column arms the exclusive lock, so TASK-08
   stock updates and the TASK-07 guard never attempt a shared->exclusive
   upgrade from inside the child direction.
4. A plain global mutex is rejected: it removes the deadlocks but serializes
   whole transactions and breaks the TASK-07 case where two transactions must
   both write before either commits.

## Recovery policy for round-2 review findings

1. Concurrent SaleItem writes and Product updates must serialize without shared-lock upgrade deadlocks. Product forecast reads acquire `FOR NO KEY UPDATE` because the same SaleItem write later updates Product stock; Sale.soldAt reads remain `FOR SHARE`.
2. A historical row accepted before TASK-09 must not make the migration undeployable only because its computed forecast is outside the JavaScript/Prisma DateTime range. Legacy backfill uses a compatibility-only wrapper that returns NULL only for the strict helper's domain-overflow error. New or subsequently modified writes continue to use the strict helper and are rejected when unrepresentable.
3. Representable legacy rows are still backfilled with the canonical formula; the compatibility policy does not weaken normal runtime correctness.

## Validation added for round-4 recovery

- advance the harness database to the reviewed head exactly (round-3 fix
  present, round-4 fix absent) and reproduce the opposite-direction cross-sale
  move, requiring PostgreSQL to abort one side;
- deploy the full chain and require both moves to commit, each moved item
  landing on its destination sale with a forecast recomputed against that
  sale's `soldAt`.

## Validation added for round-3 recovery

- rebuild a database from every migration preceding the lock-order fix;
- reproduce both reported cycles with single-statement parent operations,
  using a third transaction that pins one affected item with a trigger-free
  `SELECT ... FOR UPDATE` so the parent stalls inside its propagation window;
- require PostgreSQL to abort one side without the fix;
- deploy the full chain over that same populated database and require the
  identical interleavings to commit with the canonical forecasts and stock;
- advance every step on a real `pg_stat_activity` lock-wait condition, never a
  sleep.

## Validation added for round-2 recovery

- recreate a real database using only migrations before TASK-09;
- persist an unrepresentable but previously valid historical SaleItem;
- deploy the complete TASK-09 migration chain and require success with that legacy forecast remaining NULL;
- prove the strict runtime helper still rejects the same unrepresentable forecast;
- run two concurrent same-Product sales with sufficient stock and require both to commit, decrement stock twice, and produce correct forecasts.

## Done when

- canonical formula is covered by PostgreSQL-backed tests;
- changes to Sale.soldAt and Product.consumptionDays propagate;
- representable historical rows are backfilled;
- unrepresentable legacy rows do not abort deployment;
- new unrepresentable writes fail clearly;
- concurrent sales do not deadlock because of forecast lock upgrades;
- forecast propagation and SaleItem writes cannot deadlock on reversed lock
  order, while SaleItem writes stay concurrent with each other;
- legal cross-sale item moves in opposite directions do not deadlock;
- full Validate is green;
- independent review has no blocking findings;
- STATE/HANDOFF/evidence are reconciled before merge.
