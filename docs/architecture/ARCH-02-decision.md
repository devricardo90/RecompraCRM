# ARCH-02 — Domain date and time contract decision

Status: RESOLVED
Decision date: 2026-08-25
Decision owner: Rick Loop evidence-based architectural resolution
Baseline: `a7734f4fc270db11933b7b0461625b4c00e6263b` (`main`)

## Decision

Choose **Option A: keep `Sale.soldAt` as an instant with a declared business
timezone, with assumption A3 isolated in `lib/format/businessDate.ts`.**

That module stays the single place the domain decides what a business day is.
No migration on `Sale.soldAt`, no date library adopted, and no refactor of
TASK-11.

## Why the question was raised

ARCH-02 came from the architecture-complexity signal on TASK-11: nine review
rounds and fifteen distinct defect classes, of which five were squarely in this
contract:

- `P2_SPEC_DST_GAP_AND_OVERLAP_UNDEFINED`
- `P2_SPEC_DST_OVERLAP_WRONG_LOCAL_DATE`
- `P2_SPEC_FORECAST_ARITHMETIC_ACROSS_DST_UNDEFINED`
- `P2_SPEC_WRONG_DST_CUTOFF_DATE`
- `P2_SPEC_PAGINATION_INVARIANT_FALSE_FOR_BACKDATED_INSERTS`

The concern recorded in the roadmap was that more screens would come to depend
on the current behaviour before it had been judged.

## The evidence that settles it

TASK-12 is that second screen, and it is the test the roadmap was implicitly
asking for. It consumes the contract heavily: business-day bucketing, a
day-boundary window translated to UTC instants for SQL, date rendering, and the
inherited L4 fixed-duration/DST limitation.

Across TASK-12's seven spec review rounds and three implementation review
rounds — thirty-one distinct finding classes — **exactly one was date-related**,
`RESPONSE_NOT_DERIVED_FROM_ONE_REFERENCE_INSTANT`, and it was a defect in the
route reading the clock more than once, not in the date contract. It was caught
at the spec gate, before any code existed.

**Zero defects were found in `lib/format/businessDate.ts` itself.**

The TASK-11 defects were not evidence that instants are the wrong model. They
were evidence that the semantics were undecided and scattered. Isolating them
into one module with an explicit assumption fixed that, and the next consumer
proved it: five date defects before isolation, none after.

## Why not B

Option B stores `Sale.soldAt` as a calendar `DATE`, deriving instants when
needed.

- It is a migration on the column the TASK-09 trigger network derives
  `expectedRepurchaseAt` from. That formula is
  `Sale.soldAt + SaleItem.quantity * Product.consumptionDays days`, and ARCH-01
  fixed PostgreSQL as its sole author. Changing the column's type changes the
  arithmetic underneath a trigger graph that took nine review rounds to
  stabilise.
- It would silently change forecasts already stored.
- It does not remove the hard cases; it moves them. A calendar date still has to
  answer what a sale recorded at 23:30 with a `-04:00` offset means, and the
  sales API accepts exactly that input today.
- The one problem it genuinely dissolves — DST gap and overlap on the stored
  value — is already resolved, decided and tested.

## Why not C

Option C swaps the manual `Intl` conversion for a timezone-aware library such as
Temporal.

- A library does not decide semantics. Gap resolution (move forward, preserving
  distinctness) and overlap resolution (first occurrence) are product decisions
  this domain has already made and pinned by test. Temporal would still require
  choosing `disambiguation`, and choosing it wrongly reintroduces the same
  defects with less visible code.
- The conversion is roughly forty lines in one module, behind a contract, with
  38 assertions in the customer-history harness and 28 in the repurchase
  projection harness exercising it.
- Adopting it now means a dependency and a rewrite of proven code during a
  hardening task, for no defect currently observed.

Option C stays available as a later readability change if the manual conversion
ever becomes a maintenance problem. Nothing in this decision forecloses it.

## Consequences

- Assumption A3 (`America/Sao_Paulo`) remains explicit and remains recorded, in
  one module, changeable in one edit.
- Limitations L3 (rows written before the parsing rule keep their instant) and
  L4 (fixed-duration forecast across a DST transition) remain accepted
  residuals, each pinned by a test.
- ARCH-02 closes without reopening TASK-11 or TASK-12 and without authorising a
  refactor inside TASK-14.
- TASK-14 may proceed. Its hardening scope is errors, loading, empty states,
  accessibility and responsiveness — none of which depend on this being
  reopened.

## What would reopen this

A defect class recurring in `lib/format/businessDate.ts` on a future consumer,
or a product requirement that a sale is genuinely a calendar date rather than an
instant. Either would need a new architecture decision, a specification, a
migration impact analysis and the full review chain.
