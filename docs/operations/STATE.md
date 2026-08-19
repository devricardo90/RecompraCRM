# Recompra CRM — Rick Loop State

```yaml
schema_version: "1.1"
state_version: 41
project: RecompraCRM
roadmap: MVP-01
global_status: RUNNING
mode: CONTROLLED_AUTONOMOUS
loop_version: RICK_LOOP_V1_3
loop_upgrade_01b_status: MERGED
loop_upgrade_02_status: MERGED_V1_3_FROZEN
loop_upgrade_02_merge_main_head: 44b1f3f0612ebf815f2cfbf261596dbbd3a2fbc6
loop_upgrade_02_validation: Validate #84 / 32257064941 SUCCESS
loop_upgrade_02_review_exception: CODEX_REQUESTED_3X_NO_PUBLISHED_REVIEW
loop_freeze_until: TASK-17
executor_bridge: SCHEDULE_WAKEUP
completed_tasks:
  - TASK-01
  - TASK-02
  - TASK-03
  - TASK-04
  - TASK-05
  - TASK-06
  - TASK-07
  - TASK-08
last_completed_task: TASK-08
current_task: TASK-09
current_task_status: RECOVERING
next_eligible_task: TASK-09
branch: feat/TASK-09-repurchase-forecast
pr_number: 14
task_09_last_reviewed_head: e3be67a1d1cff634798ddaa59de6be16038be23d
task_09_last_reviewed_ci_run: 32258132550
task_09_last_reviewed_ci_status: SUCCESS
task_09_round2_findings: 2 P1
task_09_round2_findings_status: REVIEW_CLOSED_NO_LONGER_REPORTED
task_09_round3_findings: 2 P1 lock-order deadlock cycles
task_09_round3_findings_status: REVIEW_CLOSED_BOTH_P1_RESOLVED
task_09_round4_findings: 1 P2 cross-sale item move deadlock
task_09_round4_findings_status: REVIEW_CLOSED_P2_RESOLVED
task_09_round5_findings: 1 P2 stale REPEATABLE READ soldAt snapshot
task_09_round5_findings_status: REVIEW_CLOSED_P2_RESOLVED
task_09_round6_findings: 1 P1 write-vs-delete lock order
task_09_round6_findings_status: REVIEW_CLOSED_P1_RESOLVED
task_09_round7_findings: 1 P1 old product locked after sale on reassignment
task_09_round7_findings_status: REVIEW_CLOSED_P1_RESOLVED
task_09_round8_findings: 1 P1 interval overflow in legacy backfill, 1 P2 per-row lock-order scope
task_09_round8_findings_status: FIXED_LOCALLY_AWAITING_CI_AND_REVIEW
task_09_round8_p2_disposition: SCOPE_CORRECTED_RESIDUAL_ACCEPTED_RETRYABLE_40P01
task_09_round7_migration: prisma/migrations/20260819220000_lock_both_products_before_sale
task_09_round6_migration: prisma/migrations/20260819200000_lock_product_before_sale_for_forecast
task_09_round5_migration: prisma/migrations/20260819180000_order_sale_locks_for_forecast
task_09_round4_migration: prisma/migrations/20260819160000_drop_redundant_sale_share_lock
task_09_round3_head: e7cfff0980954bab06db5da5ebe98e0050083904
task_09_round3_ci_run: 32263724994
task_09_round3_ci_status: SUCCESS
task_09_round3_migration: prisma/migrations/20260819140000_serialize_forecast_lock_order
task_09_round3_regression_test: scripts/sale-forecast-lock-order-check.mjs
task_09_evidence: docs/evidence/TASK-09-validation.md
task_spec: docs/specs/TASK-09.md
max_stagnant_attempts: 3
stagnant_attempt: 0
working_tree: clean
next_action: PUSH_ROUND8_FIX_THEN_WAIT_CI_AND_INDEPENDENT_REVIEW
next_action_authorized: true
updated_at: "2026-08-19T17:25:00Z"
updated_by: Claude Code
```

TASK-01 through TASK-08 remain completed. Rick Loop v1.3 is merged and frozen
through TASK-17. TASK-09 resumed from its existing PR #14 rather than
restarting.

The round-2 P1s (legacy backfill and lock upgrade) were fixed in `a352de7` and
are no longer reported. An independent review then landed on `e3be67a` — the
exact current PR head, with Validate #88 (`32258132550`) green — and reported
two *new* P1 findings, both real deadlock cycles: `Product <-> SaleItem` from
the consumptionDays propagation meeting TASK-08's stock reconciliation, and
`Sale <-> SaleItem` from the soldAt propagation meeting TASK-07's "at least one
item" guard. Each pair locks the same two tables in opposite order.

Neither cycle can be fixed by reordering row locks, and the child->parent
direction belongs to TASK-07/08 and stays. The fix instead prevents the two
*directions* from overlapping: a statement-level BEFORE trigger — the only
point preceding every row lock — takes one transaction-scoped advisory lock,
shared for SaleItem writes (so same-direction concurrency is unchanged) and
exclusive for the two propagating parent statements. Only `UPDATE OF` the
propagating column arms the exclusive lock, so TASK-08 stock updates and the
TASK-07 guard never attempt a shared->exclusive upgrade from inside the child
direction.

A plain global mutex was tried first and rejected: it removed the deadlocks but
serialized whole transactions and deadlocked the TASK-07 harness case where two
transactions must both delete an item before either commits.
`scripts/sale-forecast-lock-order-check.mjs` reproduces both cycles on a
database built from the migrations preceding the fix, then requires the
identical interleavings to commit once the fix is deployed. All local gates are
green.

The round-3 fix is `e7cfff0980954bab06db5da5ebe98e0050083904`, Validate
`32263724994` SUCCESS. The independent review of that exact head confirmed both
P1s resolved and reported one new P2: two transactions moving items in opposite
directions between two multi-item sales still deadlocked. Both are the child
direction, so the shared gate admits both by design, but each forecast trigger
took `FOR SHARE` on its destination Sale while the deferred TASK-07 guard
updates its source Sale at commit.

`20260819160000_drop_redundant_sale_share_lock` dropped that share lock, and
Validate `32265214581` was SUCCESS on `7b78b92`.

The review of `7b78b92` then cleared that P2 and reported one more: a
`REPEATABLE READ` writer whose snapshot predates a committed `soldAt`
correction still persisted a forecast built on the old date. The gate cannot
help - the correction is already committed, so there is no overlap to exclude -
and the propagation cannot repair a row that was not attached to the sale when
it ran.

`20260819180000_order_sale_locks_for_forecast` restores a locking read strong
enough to reject that writer while keeping the round-4 cycle closed. The
review's suggested `FOR KEY SHARE` was tried and empirically rejected: a
`soldAt` correction is a non-key update, so KEY SHARE does not conflict with it
and the stale snapshot is still served. What reconciles both rounds is a fixed
lock order - a move touches two sale rows, so the trigger locks both with
`FOR NO KEY UPDATE`, lowest id first, and opposite-direction moves then wait
instead of deadlocking.

Validate `32268303782` was SUCCESS on `f89e225`. The review of that head then
cleared the round-5 P2 and reported one P1: round-5's own Sale-before-Product
order deadlocks against the delete path, which reaches Product first (TASK-08
stock restoration, AFTER DELETE) and Sale last (TASK-07 guard, at COMMIT) and
cannot be reordered.

`20260819200000_lock_product_before_sale_for_forecast` therefore locks Product
before Sale, the only order both child paths can share. Round-5's other
properties are untouched: the sales are still locked `FOR NO KEY UPDATE`, which
is what rejects a stale `REPEATABLE READ` writer, and a move still locks source
and destination lowest id first. The child direction now has one global order -
Product, then Sale by ascending id.

Validate `32271278329` was SUCCESS on `2d004f4`. The review of that head cleared
the round-6 P1 and reported one more: round 6 locked only `NEW."productId"`,
while TASK-08's reconciliation updates both products on a reassignment, so the
old product was reached only after the Sale and the cycle returned for that
mutation.

`20260819220000_lock_both_products_before_sale` locks every Product the
statement can touch, lowest id first, before any Sale. The child direction now
has a complete global order - every Product by ascending id, then every Sale by
ascending id - of which the delete path is a prefix.

Validate `32272322645` was SUCCESS on `52653c7`. The review of that head cleared
the round-7 P1 and reported two more.

The P1 is a deployment blocker: with quantity and consumptionDays both at the
INTEGER ceiling the day count overflows the `interval` cast (22015) before the
addition can overflow the timestamp (22008), and only the latter was caught, so
the legacy backfill aborted for data that was legal before TASK-09. The helper
now catches both, fixed inside `20260811130000_fix_repurchase_forecast_gaps`
because that migration's own backfill is the failing caller.

The P2 is accepted as accurate and its scope corrected rather than removed: the
round-7 ordering is per affected row, not per statement or transaction. Both
ways to close it are worse - statement-wide prelocking needs the affected rows
before any row is locked and PostgreSQL gives transition tables only to AFTER
triggers, and serializing child statements reintroduces the global mutex round
3 had to abandon. The residual is a retryable 40P01 on multi-item SaleItem
writes, which no current path issues.

The harness reproduces each defect at the exact migration depth it lives at and
requires correct behaviour on the full chain. All local gates are green.
