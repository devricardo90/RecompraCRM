# TASK-09 Spec — Previsão de recompra

Status: RECOVERY_ACTIVE
Source: `docs/product/PROJECT-SDD.md` + `docs/roadmap/ROADMAP.md`
Depends on: TASK-08
PR: #14
Current reviewed HEAD: `3344d6a3ff7bd25fbd9eacebc14473a071b31508`

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

## Recovery policy for current review findings

1. Concurrent SaleItem writes and Product updates must serialize without shared-lock upgrade deadlocks. Forecast reads that must later coexist with Product stock updates use update-strength locking rather than compatible shared locks.
2. A historical row accepted before TASK-09 must not make the migration undeployable only because its computed forecast is outside the JavaScript/Prisma DateTime range. During legacy backfill, such a row remains `expectedRepurchaseAt = NULL`; new or subsequently modified writes with an unrepresentable forecast are rejected with a clear domain error.
3. Representable legacy rows must be backfilled correctly; the exception policy must not weaken normal formula correctness.

## Done when

- canonical formula is covered by PostgreSQL-backed tests;
- changes to Sale.soldAt and Product.consumptionDays propagate;
- representable historical rows are backfilled;
- unrepresentable legacy rows do not abort deployment;
- new unrepresentable writes fail clearly;
- concurrent sales do not deadlock because of forecast lock upgrades;
- full Validate is green;
- independent review has no blocking findings;
- STATE/HANDOFF/evidence are reconciled before merge.
