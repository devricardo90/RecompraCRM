# Recompra CRM — Rick Loop State

```yaml
schema_version: "1.1"
state_version: 44
project: RecompraCRM
roadmap: MVP-01
global_status: RUNNING
mode: CONTROLLED_AUTONOMOUS
loop_version: RICK_LOOP_V1_3_1
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
  - TASK-10
last_completed_task: TASK-10
current_task: TASK-11
current_task_status: NOT_STARTED
next_eligible_task: TASK-11
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
task_spec: docs/specs/TASK-11.md
task_10_status: COMPLETED
task_10_technical_head: 7d0026f0d1b449d5108ba6c546e4bc83ddc43186
task_10_branch_ci: 32291165510
task_10_review: CODEX_REVIEW_CLEAN_ON_EXACT_HEAD
task_10_review_rounds: 5
task_10_findings_fixed: 10
task_10_pr: 16 MERGED_SQUASH
task_10_merge_main_head: f69f4e13666b0740f0952fcf17148da4d6cda2cd
task_10_main_ci_run: 32291852224
task_10_main_ci_status: SUCCESS
task_10_playwright: PASS_11_EPHEMERAL_RETRIES_0
task_10_concurrency_contract: STRATEGY_A_AND_B_IMPLEMENTED_AND_PROVEN
task_10_architecture_signal: NOT_EMITTED_4_OF_5_ROUNDS
task_10_evidence: docs/evidence/TASK-10-validation.md
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
next_action: START_TASK_11
next_action_authorized: true
updated_at: "2026-08-19T19:35:00Z"
updated_by: Claude Code
```

TASK-01 through TASK-10 are completed and integrated into `main`. Rick Loop
v1.3.1 adds the architecture-complexity signal, the exact-HEAD review invariant,
the reviewer-suggestions-are-hypotheses rule, pre/post-fix evidence, external
gate continuation, failed-attempt learning, and the rule that executable loop
changes go through a PR.

TASK-10 (interface de registro de venda) closes the residual TASK-09 left
behind. The concurrency contract was decided and committed before any product
code existed, and both strategies shipped: a deterministic mutation shape (one
transaction, items sorted by ascending `productId`, one `SaleItem` per
statement, duplicates summed) and bounded retry (three attempts, only `40P01`,
`40001` and Prisma's normalized `P2034`, whole transaction redone from scratch).
Domain invariants — `23514`, `23503`, `P2003` and TASK-09's deliberate `22003`
forecast-range failure — are never retried and reach the user as readable 4xx.

`lib/sales/saleTransaction.ts` owns that policy and is the only authorized
writer of `Sale`/`SaleItem`. Any future task that persists a sale must go
through it rather than reimplementing the shape or the retry.

Five review rounds produced ten confirmed findings, including two P1s: retry was
silently disabled for typed writes because Prisma collapses `40P01`/`40001` into
`P2034`, and the concurrency harness originally exercised a private copy of the
policy rather than production — which is precisely why the first P1 survived.
The harness now drives the production module and asserts the emitted write shape
and order from Prisma query events, so replacing the loop with `createMany`
fails it.

The architecture-complexity signal did **not** fire for TASK-10: four review
rounds carried confirmed findings against a threshold of five, computed from
`LOOP-REGISTER.jsonl` rather than estimated. `ARCH-01` remains open and
non-blocking, and must still be decided before TASK-12.

TASK-11 (histórico do cliente) is the next eligible task: its dependency
TASK-10 is satisfied and it is the lowest-numbered pending task with
dependencies met. TASK-13 is also unblocked but comes later in roadmap order.
