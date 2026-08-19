# TASK-09 Spec — Previsão de recompra

Status: IMPLEMENTED_VALIDATED_WAITING_REVIEW
Source: `docs/product/PROJECT-SDD.md` + `docs/roadmap/ROADMAP.md`
Depends on: TASK-08
PR: #14
Last independently reviewed HEAD: `3344d6a3ff7bd25fbd9eacebc14473a071b31508`
Current technical HEAD: `a352de7affd6d331c992282f61ac4f335e6783b2`
Validation: Validate #87 / `32257807500` SUCCESS

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

1. Concurrent SaleItem writes and Product updates must serialize without shared-lock upgrade deadlocks. Product forecast reads acquire `FOR NO KEY UPDATE` because the same SaleItem write later updates Product stock; Sale.soldAt reads remain `FOR SHARE`.
2. A historical row accepted before TASK-09 must not make the migration undeployable only because its computed forecast is outside the JavaScript/Prisma DateTime range. Legacy backfill uses a compatibility-only wrapper that returns NULL only for the strict helper's domain-overflow error. New or subsequently modified writes continue to use the strict helper and are rejected when unrepresentable.
3. Representable legacy rows are still backfilled with the canonical formula; the compatibility policy does not weaken normal runtime correctness.

## Validation added for recovery

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
- full Validate is green;
- independent review has no blocking findings;
- STATE/HANDOFF/evidence are reconciled before merge.
