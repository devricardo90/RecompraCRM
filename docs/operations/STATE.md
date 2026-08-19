# Recompra CRM — Rick Loop State

```yaml
schema_version: "1.1"
state_version: 37
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
task_09_round4_findings_status: FIXED_LOCALLY_AWAITING_CI_AND_REVIEW
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
next_action: PUSH_ROUND4_FIX_THEN_WAIT_CI_AND_INDEPENDENT_REVIEW
next_action_authorized: true
updated_at: "2026-08-19T15:20:00Z"
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

`20260819160000_drop_redundant_sale_share_lock` drops that share lock. It only
existed so a forecast read would conflict with a concurrent `soldAt`
correction, and the round-3 gate now excludes that overlap entirely, so the
lock contributed nothing but the cycle. `Product` stays on `FOR NO KEY UPDATE`,
which serializes same-direction writers before TASK-08's stock update and is
still required. The harness now reproduces all three cycles at the exact
migration depth each one lives at, and requires all three to commit on the full
chain. All local gates are green.
