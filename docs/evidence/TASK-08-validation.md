# TASK-08 — Sale/Stock Atomic Transaction Evidence

## Scope and baseline

- Task: `TASK-08 — Transação de venda e estoque`
- Mode: `CONTROLLED_AUTONOMOUS`
- Branch: `feat/TASK-08-sale-stock-transaction`
- Baseline: `9d050028cd2dbc95bacfc8dd6b91e32c13d345b9` (main, post TASK-07 merge + Rick Loop controller)
- Initial technical head: `00c3b0bbdda5eac8b1dc0f2a739d037d82ba98a0`
- SaleItem update/delete reconciliation fix head: `dc03d6ea6c2c4edab4baa750e89c0d96c600478d`
- Product.id immutability fix head: `827f2fdc51c6d7a882ab51213c8504dde231667e`
- Pull request: #12

Canonical rules covered: "A confirmação da venda reduz o estoque atomicamente" and
"O estoque não pode ficar negativo" (`docs/product/PROJECT-SDD.md`). Scope stays
at the persistence layer only, matching TASK-07's discipline — no Sale API or UI.

## Implemented model

- `Product_currentStock_non_negative` CHECK constraint.
- `AFTER INSERT ON "SaleItem"` trigger reduces the owning Product's stock via a
  real `UPDATE` (row-locked, not app-side read-then-write), so concurrent
  sales of the same product serialize instead of racing.
- `AFTER DELETE ON "SaleItem"` trigger restores stock; `AFTER UPDATE OF
  "quantity", "productId" ON "SaleItem"` trigger reconciles the delta — both
  needed because TASK-07 already permits deleting one item of a multi-item
  Sale and updating an item's quantity/product.
- `Product.id` is immutable (`BEFORE UPDATE OF "id"`), mirroring TASK-07's
  `Sale.id` fix — without it, `SaleItem_productId_fkey`'s `ON UPDATE CASCADE`
  would let a Product rename double-charge stock through the reconciliation
  trigger above.
- Any change that would drive stock negative fails the triggering
  INSERT/UPDATE/DELETE immediately, aborting the whole transaction — no
  partial update.

## Deterministic validation

`scripts/sale-stock-transaction-check.mjs` (`npm run test:sale-stock`), isolated
PostgreSQL schema per run, same pattern as the Customer/Product/Sale harnesses.
10 cases: multi-item reduction; an under-stocked sibling item rejecting the
whole sale with no stock change to either item; reaching exactly zero stock;
direct negative update rejected outside the Sale flow; two concurrent
overlapping sales for the same product (exactly one commits); deleting one
item restores only that item's product; quantity increase/decrease adjusts by
the delta (increase rejected with no partial change if it would go negative);
productId reassignment moves stock between products (rejected with no partial
change if the new product lacks room); direct `Product.id` mutation rejected.
Stable across 12 total local runs (5 + 4 + 3 across the three implementation
rounds).

Full gate suite passed on every pushed commit: `db:generate`, `db:validate`,
`db:migrate`, `db:health`, `test:migration-compat`, `npm test` (Customer/
Product/Sale/Sale-stock), `test:product-api`, `test:customer-api`,
`test:loop-controller`, `lint`, `typecheck`, `build`, `git diff --check`.
Playwright: `NOT_REQUIRED_NO_UI_CHANGE`.

## GitHub Actions and review

- Round 1 (`00c3b0b`): Validate SUCCESS. Codex found the trigger was
  insert-only — `SaleItem` update/delete (already permitted by TASK-07) never
  reconciled stock.
- Round 2 (`dc03d6e`): fixed with delta-reconciling triggers; Validate
  SUCCESS. Codex found `Product.id`'s `ON UPDATE CASCADE` FK would let a
  rename double-charge stock through those same triggers.
- Round 3 (`827f2fd`): fixed by making `Product.id` immutable; Validate
  SUCCESS (run `31422603924`). Codex returned no further findings.
- PR #12 merged into `main` at `0b31d5b13aab763b2bd87f0eaf109b8b21c1941f`;
  post-merge Validate (`31480804711`) confirmed `SUCCESS`.

## Status

TASK-08 is complete and merged. TASK-09 (previsão de recompra) is the next
eligible task.
