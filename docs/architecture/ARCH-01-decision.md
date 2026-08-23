# ARCH-01 — Forecast ownership decision

Status: RESOLVED
Decision date: 2026-08-23
Decision owner: Rick Loop evidence-based architectural resolution

## Decision

Choose **Option A: keep the repurchase forecast persisted and maintained
synchronously by PostgreSQL triggers**.

`SaleItem.expectedRepurchaseAt` is the read source of truth. Its canonical
value is:

```text
Sale.soldAt + SaleItem.quantity * Product.consumptionDays days
```

The database derivation owns the value. Application APIs and UI consumers may
provide or change the base fields through their existing contracts, but they
must not calculate a second forecast.

## Evidence and compatibility

- The SDD defines the formula and one forecast per sale item.
- TASK-09 already implements the field, the canonical helper and the trigger
  network, including recomputation on quantity, product, sale date and
  consumption-duration changes.
- TASK-09 also makes direct writes to `expectedRepurchaseAt` recompute the
  canonical value, handles representable legacy backfill and leaves
  unrepresentable legacy values `NULL`.
- TASK-11 is a read-only projection and already reads the persisted field,
  rendering `NULL` as `—` without recalculation.
- Replacing the design now would rewrite a trigger graph that required nine
  review rounds to stabilize and would silently change forecasts already
  stored.

## Ownership, freshness and recomputation

- Ownership of derivation: PostgreSQL functions/triggers in the TASK-09
  migration chain.
- Source data: `Sale.soldAt`, `SaleItem.quantity`,
  `SaleItem.productId`, and `Product.consumptionDays`.
- Recompute points: SaleItem insert/update, Sale.soldAt update,
  Product.consumptionDays update, and a direct forecast-column write.
- Freshness policy: synchronous in the same transaction. A committed base
  change has a forecast recomputed before consumers can read the commit.
- Idempotency: repeated recomputation with identical base values produces the
  same timestamp and no additional domain event.
- Stale-data policy: new or mutated rows fail closed when the forecast cannot
  be represented; old legacy rows may remain `NULL` under the explicit TASK-09
  compatibility policy. Retryable PostgreSQL conflicts remain governed by the
  existing transaction/retry contract.

## Schema, migration and API contract

This decision introduces **no schema change and no migration**. The existing
nullable `expectedRepurchaseAt` column and trigger chain remain authoritative.
Any future change to this ownership requires a new architecture decision,
specification, migration impact analysis and the full review/gate chain.

TASK-12 must consume the field through a read projection: classify the stored
forecast into overdue, today and the next seven days using the shared business
date contract, without recomputing it in the route, service or browser. Its
future spec must define the query/API shape while preserving this ownership.

## Risks and test strategy

The accepted risks are trigger complexity and lock-order sensitivity, the
known fixed-duration/DST limitation L4, and `NULL` forecasts on unrepresentable
legacy rows. The mitigation is the existing PostgreSQL regression suite and
lock-order evidence from TASK-09, plus TASK-12 tests that prove read-only
consumption, classification from stored values, `NULL` handling and freshness
after each base-field mutation.

## Consequences

ARCH-01 is resolved without refactoring TASK-09 or implementing TASK-12. The
dashboard may now be specified against a stable persisted source of truth;
TASK-12 becomes eligible in the deterministic resolver, with its own spec gate
still required before implementation.
