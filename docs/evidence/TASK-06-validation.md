# TASK-06 — Product Interface and Inventory Evidence

## Scope

- Task: `TASK-06 — Interface de produtos e estoque`
- Branch: `feat/TASK-06-product-interface`
- Mode: `CONTROLLED_AUTONOMOUS`
- Baseline: `163ff93b27edd6d7ab76525318c323b46ebdfb8c`
- Baseline CI: Validate #40 / `31319322422` — `SUCCESS`
- Initial technical head: `efc41c55def9cd0559a6219ea3999a224575dbb7`
- Blank-field fix head: `2b9cf167ee92875f5b869d9c1cbc1b70a5de14d8`
- INTEGER payload-range fix head: `428992761162576e656e015840730c478f060f85`
- Final technical head: `7e1c9670535421af7bfce2e040bf306a2e783a08`
- Final reviewed branch head: `4382895c8a78062453ebb474f57cab038dcdaf93`
- Pull request: #10 — merged
- Merge/main head: `c9cb0fba8a907ce46d385c2e03fa7411b48c03c8`

The implementation is limited to the Product interface and its Product API
integration. Sale, stock reduction, dashboards, authentication and TASK-07
workflows were not started.

## Implemented behavior

- `/products` provides a mobile-first Product list and search by name or unit.
- Create and edit flows persist `name`, `unit`, `currentStock`,
  `minimumStock` and `consumptionDays` through the Product API.
- Empty, loading and error states are represented, including retry behavior.
- Low-stock status is shown when current stock is at or below the configured
  minimum.
- Blank current or minimum stock fields are rejected before numeric coercion;
  they cannot silently become zero.
- `currentStock`, `minimumStock`, `consumptionDays` and Product route IDs are
  constrained to PostgreSQL signed 32-bit `INTEGER` range. Oversized values
  return HTTP 400 and never reach Prisma as infrastructure failures.
- Product API routes cover list/create/update and return validation, not-found
  and infrastructure responses with their intended status codes.
- No `updatedAt` date is displayed; business timezone is not canonically
  defined and date display remains deferred.

## Validation

### Local deterministic gates

- `npm install --no-audit --no-fund`: PASS
- `npm run db:generate`: PASS
- `npm run db:validate`: PASS with temporary schema-validation URL
- `node --check scripts/product-api-integration-check.mjs`: PASS
- `node --check scripts/product-model-check.mjs`: PASS
- `npm run lint`: PASS
- `npm run typecheck`: PASS
- `npm run build`: PASS
- `git diff --check`: PASS
- secret scan of the technical diff: PASS

An isolated PostgreSQL 16 container was started on port 55432 under Compose
project `recompra-task06-p2`. All five migrations applied from an empty
database; health, Customer/Product persistence and Product API integration
passed. The harness proved HTTP 400 for oversized POST payload fields,
oversized PUT payload fields and `PUT /api/products/2147483648`, while a valid
missing ID continued to return 404. The temporary container, network and
volume were removed after validation.

### GitHub Actions

Validate #46 / run `31325836264` — `SUCCESS` for
`7e1c9670535421af7bfce2e040bf306a2e783a08`.

The run passed migrations, database health, migration compatibility, Customer
and Product persistence, Customer and Product API integration, lint,
typecheck and build against PostgreSQL. Product API integration includes blank
stock fields, all three oversized payload fields in POST/PUT and oversized
Product route IDs returning HTTP 400.

Validate #48 / run `31327725399` — `SUCCESS` for the final reviewed branch
head `4382895c8a78062453ebb474f57cab038dcdaf93`. Validate #49 / run
`31328149760` — `SUCCESS` for the merge/main head
`c9cb0fba8a907ce46d385c2e03fa7411b48c03c8`.

### Ephemeral Playwright

PASS without saved screenshots, traces, videos or test files:

- desktop `1440x900`: empty state, list, edit and low-stock indicator;
- mobile `390x844`: list/search and no horizontal overflow;
- short landscape `844x390`: create dialog, name field and save action
  reachable/clickable, no horizontal overflow;
- focused INTEGER guard check in desktop `1440x900` and mobile `390x844`:
  all three inputs expose `max=2147483647`, the JavaScript guard rejects an
  oversized value without issuing a Product POST, and no horizontal overflow
  or critical console error occurs;
- console: no critical errors.

## Review state and handoff

Codex reviewed `2b9cf167ee92875f5b869d9c1cbc1b70a5de14d8` and identified the payload
range P2. After its fix, Codex reviewed `428992761162576e656e015840730c478f060f85`
and identified the equivalent Product ID bound plus stale evidence. Both are
fixed in `7e1c9670535421af7bfce2e040bf306a2e783a08`, validated by Validate #46.
The remaining P3 documentation finding was fixed in
`4382895c8a78062453ebb474f57cab038dcdaf93`; Codex reviewed that head and
reported no major issues. PR #10 was merged as
`c9cb0fba8a907ce46d385c2e03fa7411b48c03c8`, and the post-merge Validate #49
passed on `main`.

TASK-06 is complete. TASK-07 is the next eligible task and has not yet been
implemented.
