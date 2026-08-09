# TASK-07 — Sale and SaleItem Persistence Evidence

## Scope and baseline

- Task: `TASK-07 — Modelo de vendas`
- Mode: `CONTROLLED_AUTONOMOUS`
- Branch: `feat/TASK-07-sales-model`
- Baseline: `5ce2365179b0b9519bb7312fed3990543043493c`
- Baseline CI: Validate #50 / `31329344342` — `SUCCESS`
- Technical head: `693c4504a6799fefdb28e0fff70fe37c1c780495`
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
- No stock mutation, repurchase formula, Sale API or Sale UI was implemented.

## Deterministic validation

An isolated PostgreSQL 16 instance used Compose project `recompra-task07` on
port 55433. No external container was changed. The isolated container, network
and volume were removed after validation.

- `npm install --no-audit --no-fund`: PASS
- `npm run db:generate`: PASS
- `npm run db:validate`: PASS with the isolated local URL
- database recreation from an empty volume: PASS
- `npm run db:migrate`: PASS; all six migrations applied in order
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

## Status

TASK-07 is technically verified green and awaits independent Codex review.
TASK-08 has not been started.
