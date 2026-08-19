# Recompra CRM — Current Handoff

```yaml
schema_version: "1.1"
run_id: RCRM-MVP01-RUN-003
loop_id: RCRM-TASK09-V1.3-RECOVERY
status: RECOVERING
mode: CONTROLLED_AUTONOMOUS
loop_version: RICK_LOOP_V1_3
current_task: TASK-09
current_task_status: RECOVERING
current_pr: 14
current_branch: feat/TASK-09-repurchase-forecast
last_reviewed_head: e3be67a1d1cff634798ddaa59de6be16038be23d
last_reviewed_ci_run: 32258132550
last_reviewed_ci_status: SUCCESS
round2_findings_status: REVIEW_CLOSED_NO_LONGER_REPORTED
round3_findings: 2 P1 lock-order deadlock cycles
round3_findings_status: REVIEW_CLOSED_BOTH_P1_RESOLVED
round4_findings: 1 P2 cross-sale item move deadlock
round4_findings_status: REVIEW_CLOSED_P2_RESOLVED
round5_findings: 1 P2 stale REPEATABLE READ soldAt snapshot
round5_findings_status: REVIEW_CLOSED_P2_RESOLVED
round6_findings: 1 P1 write-vs-delete lock order
round6_findings_status: REVIEW_CLOSED_P1_RESOLVED
round7_findings: 1 P1 old product locked after sale on reassignment
round7_findings_status: REVIEW_CLOSED_P1_RESOLVED
round8_findings: 1 P1 interval overflow in legacy backfill, 1 P2 per-row lock-order scope
round8_findings_status: FIXED_LOCALLY_AWAITING_CI_AND_REVIEW
round3_head: e7cfff0980954bab06db5da5ebe98e0050083904
round3_ci_run: 32263724994
round3_ci_status: SUCCESS
evidence: docs/evidence/TASK-09-validation.md
task_spec: docs/specs/TASK-09.md
loop_upgrade_02_main_head: 44b1f3f0612ebf815f2cfbf261596dbbd3a2fbc6
loop_upgrade_02_status: MERGED_V1_3_FROZEN
next_action: WAIT_CI_AND_INDEPENDENT_REVIEW_OF_ROUND8_HEAD
human_intermediate_approval_required: false
```

## Resume order

1. Inspect PR #14 and confirm the current head is the round-8 interval-overflow fix.
2. Confirm the Validate run for that exact head is SUCCESS.
3. Obtain an independent review for that exact head. Do not describe the
   round-8 findings as review-closed until that happens. Rounds 3-7 *are*
   review-closed: the reviews of `e7cfff0`, `7b78b92`, `f89e225`,
   `2d004f4` and `52653c7` no longer report those findings.
4. If review finds a real defect, stay in RECOVERING, fix only that finding,
   reset stagnation on real progress, validate, and review again.
5. If review is clean, reconcile evidence/STATE/HANDOFF/ROADMAP, merge PR #14,
   validate `main`, then mark TASK-09 COMPLETED and release TASK-10.

## Round-3 recovery (this loop)

The review that landed on `e3be67a` — the exact PR head, CI green — reported
two new P1 deadlock cycles rather than clearing the branch:

- `Product <-> SaleItem`: consumptionDays propagation vs the forecast read plus
  TASK-08 stock reconciliation.
- `Sale <-> SaleItem`: soldAt propagation vs the forecast read plus TASK-07's
  "at least one item" guard.

Neither is fixable by reordering row locks — in both, the parent row is already
held by the statement whose AFTER trigger propagates, and the child row by the
statement whose BEFORE trigger reads the parent. The child->parent direction
belongs to TASK-07/08 and stays.

`prisma/migrations/20260819140000_serialize_forecast_lock_order` therefore stops
the two *directions* from overlapping: a statement-level BEFORE trigger takes
one transaction-scoped advisory lock before any row lock — shared for SaleItem
writes, exclusive for the two propagating parent statements. Only `UPDATE OF`
the propagating column arms the exclusive lock, so TASK-08 stock updates and the
TASK-07 guard never attempt a shared->exclusive upgrade.

A plain global mutex was tried first and rejected: it removed the deadlocks but
serialized whole transactions and deadlocked the TASK-07 harness case where two
transactions must both delete an item before either commits. That failure is
why the shipped design is a shared/exclusive split.

`scripts/sale-forecast-lock-order-check.mjs` (wired into
`test:repurchase-forecast`, therefore into Validate) reproduces both cycles on a
database built from the migrations preceding the fix, then requires the
identical interleavings to commit once the fix is deployed. All local gates are
green, including the previously hanging `test:sale`. The fix is
`e7cfff0980954bab06db5da5ebe98e0050083904`; Validate `32263724994` SUCCESS.

## Round-4 recovery (this loop)

The review of `e7cfff0` cleared both round-3 P1s and reported one P2: two
transactions moving items in opposite directions between two multi-item sales
(A -> B and B -> A) still deadlocked. Both are the child direction, so the
shared gate admits both by design; each forecast trigger then took `FOR SHARE`
on its *destination* Sale while the deferred `SaleItem_preserves_sale_items`
guard updates its *source* Sale at COMMIT, so each share lock blocked the
other's update.

`prisma/migrations/20260819160000_drop_redundant_sale_share_lock` drops that
share lock. It existed only so a forecast read would conflict with a concurrent
`soldAt` correction, and since round-3 such a correction takes the cluster lock
exclusively while every SaleItem write holds it shared - they can no longer
overlap at all. `Product` stays on `FOR NO KEY UPDATE`: that lock serializes
two same-direction writers before TASK-08's stock update and is still needed.

The harness now reproduces each cycle at the exact migration depth it lives at
- the two P1s before the round-3 fix, the P2 at the reviewed head itself - and
requires all three to commit on the full chain.

## Round-5 recovery (this loop)

The review of `7b78b92` cleared the round-4 P2 and reported one more: a
`REPEATABLE READ` writer whose snapshot predates a committed `soldAt`
correction still persisted a forecast built on the old date. The advisory gate
cannot help - the correction is already committed, so there is no overlap in
time to exclude - and the propagation cannot repair a row that was not attached
to the sale when it ran.

`prisma/migrations/20260819180000_order_sale_locks_for_forecast` restores a
locking read strong enough to reject that writer while keeping the round-4
cycle closed. The review suggested `FOR KEY SHARE`; that was implemented,
tested against a real database, and rejected - a `soldAt` correction is a
non-key update, so KEY SHARE does not conflict with it and the stale snapshot
is still served. What reconciles both rounds is a fixed lock order: a move
touches two sale rows, so the trigger locks both with `FOR NO KEY UPDATE`,
lowest id first, and opposite-direction moves wait instead of deadlocking. The
trigger never fires on DELETE, so TASK-07's concurrent removals are untouched.

The harness now covers four defect classes, each reproduced at its own
migration depth, and requires correct behaviour on the full chain.

## Round-6 recovery (this loop)

The review of `f89e225` cleared the round-5 P2 and reported one P1: round-5's
own Sale-before-Product order deadlocks against the delete path. An insert or
quantity update racing the deletion of another item of the same sale and
product left the writer holding the Sale row and waiting for Product, while
the delete held Product and waited at COMMIT for that Sale.

The delete path cannot be reordered - its Product update is TASK-08's
AFTER DELETE stock restoration and its Sale update is TASK-07's deferred
guard. So `20260819200000_lock_product_before_sale_for_forecast` locks Product
before Sale, the only order both child paths can share. Round-5's other
properties are untouched: sales are still locked FOR NO KEY UPDATE (which
rejects the stale REPEATABLE READ writer) and a move still locks source and
destination lowest id first.

The harness now covers five defect classes, each reproduced at its own
migration depth.

## Round-7 recovery (this loop)

The review of `2d004f4` cleared the round-6 P1 and reported one more: round 6
locked only `NEW."productId"`, but TASK-08's reconciliation updates both
products on a reassignment, so the old product was reached only after the Sale
and the `Sale -> Product` cycle returned for that mutation.

`prisma/migrations/20260819220000_lock_both_products_before_sale` locks every
Product the statement can touch, lowest id first, before any Sale. The child
direction now has a complete global order - every Product by ascending id, then
every Sale by ascending id - of which the delete path is a prefix. All earlier
properties are preserved.

The harness now covers six defect classes, each reproduced at its own migration
depth.

## Round-8 recovery (this loop)

The review of `52653c7` cleared the round-7 P1 and reported two more.

P1, a deployment blocker: with quantity and consumptionDays both at the INTEGER
ceiling the day count overflows the `interval` cast (22015) before the addition
can overflow the timestamp (22008); only the latter was caught, so the legacy
backfill aborted for data legal before TASK-09. The helper now catches both,
fixed inside `20260811130000_fix_repurchase_forecast_gaps` because that
migration's own backfill is the failing caller. Proven both ways against a real
database.

P2, accepted and scoped rather than removed: the round-7 ordering is per
affected row, not per statement or transaction. Statement-wide prelocking needs
the affected rows before any row is locked and PostgreSQL gives transition
tables only to AFTER triggers; serializing child statements reintroduces the
global mutex round 3 had to abandon. The residual is a retryable 40P01 on
multi-item SaleItem writes, which no current path issues. TASK-10 should keep
one item per statement, or retry on 40P01.

The v1.3 controller, task-level SDD, anti-drift reconciliation and recovery
policy are part of this branch. TASK-09 was resumed, not restarted.
