# TASK-11 — Customer History Evidence

## Scope and baseline

- Task: `TASK-11 — Histórico do cliente`
- Mode: `CONTROLLED_AUTONOMOUS`
- Loop: `RICK_LOOP_V1_3_1`
- Branch: `feat/TASK-11-customer-history`
- Baseline: `c3b8e16704a0b1971d8d5f3802fa9a18d99b0976` (main)
- Spec: `docs/specs/TASK-11.md`

## Spec gate — 9 rounds, 17 findings, before any product code

The spec was derived, reviewed and corrected **before** implementation, which is
where most of this task's value ended up. Four domain facts were verified against
a real database rather than assumed: `unitPrice` is `null` from the TASK-10 flow,
renaming a product changes past sales, and neither a referenced product nor a
customer with sales can be deleted (`onDelete: Restrict`, and no `DELETE`
endpoint exists).

Findings that would otherwise have become defects in code:

| Round | Finding |
| --- | --- |
| 1 | item order not total — `(saleId, productId)` is not unique |
| 1 | scalar cursor cannot seek a composite order |
| 1 | cursor with no ownership rule silently truncates history |
| 1 | contradictory concurrent-pagination criterion |
| 1 | **date-only input would shift a day** once the formatter changed |
| 2 | pre-change stored rows unaddressed |
| 2 | offset-less date-times untested |
| 2 | DST gaps and overlaps undefined |
| 3 | "no durable environment" premise **false** — local volume persists |
| 3 | DST overlap named the wrong local date |
| 4 | gap policy unprovable by its own evidence |
| 4 | forecast arithmetic across a transition undefined |
| 5 | DST cutoff stated as "2019" instead of `2019-02-17` |
| 5 | cursor order had no matching index |
| 6 | explicit-offset forms narrower than the parser accepts |
| 7 | positive offset forms untested |
| 8 | pagination invariant false for backdated inserts |

Two of these corrected claims I had asserted as verified. Round 9 returned no
findings.

## Implementation

- `lib/format/businessDate.ts` — the one place the business timezone is decided
  (assumption A3). Interprets caller input *and* renders output, because
  replacing only the formatter would have shifted valid date-only input backwards
  by a day. Resolves DST gaps by moving forward, overlaps to the first
  occurrence.
- `lib/customers/customerHistory.ts` — read-only projection with the composite
  `(soldAt, id)` seek, cursor ownership validation, and total ordering. Policy
  lives here, not in the route, so the harness drives production code.
- `app/api/customers/[id]/sales/route.ts` — `200/400/404/503`.
- `app/customers/[id]/history/` — mobile-first page, reachable from the customer
  card.
- `prisma/migrations/20260820120000_index_customer_history_order` — additive
  `@@index([customerId, soldAt, id])` matching the cursor order.
- TASK-10's forecast display now uses the same formatter, so the app has one date
  rule instead of two.

## Deterministic evidence

`scripts/customer-history-check.mjs` (`npm run test:customer-history`, in
`npm test` and in Validate), isolated schema per run, driving the production
modules including `parseSaleInput`.

Covers: the full interpretation table (date-only, offset-less, and all five
explicit-offset forms, each asserted against both stored instant and displayed
day); impossible calendar dates; total sale ordering with an `id` tiebreak on
equal `soldAt`; item ordering with a duplicate-product sale; customer isolation;
canonical forecasts and `NULL` rendering as `—`; empty history distinguished from
a missing customer; cursor traversal reproducing the full order including a
**backdated** sale whose id order contradicts its `soldAt`; a foreign cursor
rejected; concurrent inserts in **both** directions; `limit`/`cursor` validation;
the L4 fixed-duration forecast across a DST transition; the L3 midnight-UTC row;
and the L1 product rename.

## Playwright — ephemeral

10 scenarios, `retries: 0`, **10 passed in 15.9 s**, then removed per
`docs/operations/PLAYWRIGHT-EPHEMERAL.md`. Mobile 390×844 plus desktop 1280×900:
ordering and forecasts, multi-item sale, customer isolation, empty state, missing
customer, load failure with retry, paging without duplication, reachability from
the customers screen, desktop parity and back-navigation, and no horizontal
scrolling with a long product name.

One test defect was fixed during the run: `allTextContents()` does not retry, so
the desktop assertion read an empty list before it rendered. The application was
correct; the test was not.

## Implementation review round 1 — three findings, all confirmed

- **Milliseconds were silently moved.**  compared a
  millisecond-bearing instant against Intl's second-precision reading, so the
  fractional error was added back into every candidate:  became ,
   became . The offset is now computed on a whole-second instant.
- **The explicit-offset path skipped calendar validation.** Delegating straight
  to Thu, Aug 20, 2026  2:27:57 PM accepted  and normalised it to March 2 — a
  regression against what the API rejected before this module existed. The
  grammar and calendar are now checked on that path too.
- **A pagination failure wiped the loaded history.** The outer  branch
  took precedence over the list, so a failed "carregar mais" replaced the whole
  screen with the first-page error panel and the inline message was unreachable.
  Pagination failures now use their own state and leave the loaded rows visible.

Each is pinned by a regression case in the harness.

## Local gates

| Gate | Result |
| --- | --- |
| `db:migrate` (22 migrations) | PASS |
| `test:migration-compat` | PASS |
| `test:customer` / `test:product` / `test:sale` / `test:sale-stock` | PASS |
| `test:repurchase-forecast` (3 harnesses) | PASS |
| `test:sale-registration` | PASS |
| `test:customer-history` | PASS |
| `test:product-api` / `test:customer-api` / `test:loop-controller` | PASS |
| `lint` / `typecheck` / `build` | PASS |
| Playwright ephemeral | PASS (10) |

## Limitations carried forward

| # | Limitation |
| --- | --- |
| L1 | History shows the **current** product name; no snapshot. |
| L2 | No price, because the sale flow never captures one. |
| L3 | Rows written at midnight UTC before the parsing rule render by their stored instant. No automatic migration: intent is unrecoverable. The local database persists (named volume), so an explicit reset is required for anyone holding such rows. |
| L4 | Forecast arithmetic is fixed-duration, not business-calendar. For a backdated sale crossing a DST transition the forecast can display on the sale's own day. Coincides with calendar days from `2019-02-17`. |

`ARCH-01` remains open and non-blocking, and must be resolved before TASK-12.
