# Recompra CRM — Rick Loop State

```yaml
schema_version: "1.1"
state_version: 43
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
  - TASK-09
last_completed_task: TASK-09
current_task: TASK-10
current_task_status: NOT_STARTED
next_eligible_task: TASK-10
branch: main
pr_number: none
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
task_09_round8_findings_status: REVIEW_CLOSED_BOTH_RESOLVED
task_09_round9_findings: 1 P2 expectedRepurchaseAt writable directly
task_09_round9_findings_status: REVIEW_CLOSED_P2_RESOLVED
task_09_round9_migration: prisma/migrations/20260820000000_recompute_forecast_on_direct_write
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
task_spec: docs/specs/TASK-10.md
task_09_status: COMPLETED
task_09_technical_head: 82c68a7e6c73a0f141a2c8b30ae7d7632b750dee
task_09_branch_ci: 32274791956
task_09_review: CODEX_REVIEW_CLEAN_ON_EXACT_HEAD
task_09_review_rounds: 9
task_09_pr: 14 MERGED_SQUASH
task_09_merge_main_head: e4de101bcbd9d632a72c6a81efb3cf02a7cf0c8d
task_09_main_ci_run: 32282972720
task_09_main_ci_status: SUCCESS
task_09_accepted_residual: RETRYABLE_40P01_ON_MULTI_ITEM_SALEITEM_STATEMENTS
task_09_architecture_signal: ARCHITECTURE_COMPLEXITY_SIGNAL
task_09_architecture_item: ARCH-01
external_gate: none
max_stagnant_attempts: 3
stagnant_attempt: 0
working_tree: clean
next_action: START_TASK_10
next_action_authorized: true
updated_at: "2026-08-19T17:45:00Z"
updated_by: Claude Code
```

TASK-01 through TASK-09 are completed and integrated into `main`. Rick Loop
v1.3 is merged and frozen through TASK-17.

TASK-09 (previsão de recompra) persists a per-SaleItem forecast using the
canonical formula, computed and maintained entirely in the persistence layer:
computed on insert, recomputed when quantity/productId/saleId change,
propagated when `Sale.soldAt` or `Product.consumptionDays` change, and
recomputed rather than stored when a caller writes the column directly.
Representable historical rows are backfilled; unrepresentable legacy rows stay
NULL instead of blocking deployment, while new unrepresentable writes are
rejected.

Nine independent review rounds hardened the concurrency behaviour of that
trigger web against TASK-07's item guard and TASK-08's stock reconciliation.
Eleven findings were confirmed and fixed; the final review of the exact head
`82c68a7e6c73a0f141a2c8b30ae7d7632b750dee` reported no major issues. PR #14 was squash-merged into `main` at
`e4de101bcbd9d632a72c6a81efb3cf02a7cf0c8d`, and the post-merge Validate run `32282972720` is SUCCESS.

One residual is accepted and recorded rather than hidden: the lock ordering is
a per-row guarantee, so a multi-item SaleItem statement or transaction can
still produce a retryable `40P01`. No current application path issues one, and
TASK-10's spec now carries a binding concurrency contract that must be settled
before its implementation.

The nine rounds also produced an `ARCHITECTURE_COMPLEXITY_SIGNAL`, recorded as
the non-blocking `ARCH-01` roadmap item: whether `expectedRepurchaseAt` should
remain a synchronously persisted derived field. It must be decided before
TASK-12 couples a dashboard to the current persistence design. It does not
reopen TASK-09.

TASK-10 (interface de registro de venda) is the next eligible task: its
dependencies TASK-04, TASK-06 and TASK-09 are all satisfied, and it is the
lowest-numbered pending task with dependencies met. TASK-13 is also unblocked
but comes later in roadmap order.
