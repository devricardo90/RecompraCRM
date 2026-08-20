# Recompra CRM — Rick Loop State

```yaml
schema_version: "1.1"
state_version: 45
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
  - TASK-11
last_completed_task: TASK-11
current_task: TASK-12
current_task_status: NOT_STARTED
next_eligible_task: TASK-12
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
task_spec: docs/specs/TASK-12.md
task_11_status: COMPLETED
task_11_technical_head: 955baeb6cbc3cbc89f43e6f948392c291cfbea77
task_11_review: CODEX_REVIEW_CLEAN_ON_EXACT_HEAD
task_11_review_rounds: 10
task_11_spec_rounds: 9
task_11_findings_fixed: 20
task_11_pr: 17 MERGED_SQUASH
task_11_merge_main_head: d7194558f21bf9cf07c88062f85f0d75b255634b
task_11_main_ci_run: 32370638624
task_11_main_ci_status: SUCCESS
task_11_playwright: PASS_11_EPHEMERAL_RETRIES_0
task_11_evidence: docs/evidence/TASK-11-validation.md
task_11_limitations: L1_CURRENT_PRODUCT_NAME, L2_NO_PRICE, L3_PRE_RULE_MIDNIGHT_UTC_ROWS, L4_FIXED_DURATION_FORECAST
business_timezone_assumption: A3_AMERICA_SAO_PAULO_IN_LIB_FORMAT_BUSINESSDATE
task_11_architecture_signal: ARCHITECTURE_COMPLEXITY_SIGNAL_9_ROUNDS
task_11_architecture_item: ARCH-02
task_12_blocked_by: ARCH-01
open_architecture_items: ARCH-01, ARCH-02
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
next_action: RESOLVE_ARCH_01_THEN_START_TASK_12
next_action_authorized: true
updated_at: "2026-08-20T12:55:00Z"
updated_by: Claude Code
```

TASK-01 through TASK-11 are completed and integrated into `main`.

TASK-11 (histórico do cliente) is a read-only projection: one customer's sales,
newest first, each item carrying the forecast the database derived. Ordering is
total — sales by `soldAt DESC` with an `id DESC` tiebreak, items by `productId`
then `id`, because `(saleId, productId)` is not unique. Pagination seeks
composite `(soldAt, id)`, since `soldAt` is caller-supplied and an id-only
cursor would skip or repeat rows once a sale is backdated; a cursor naming
another customer's sale is rejected rather than silently truncating the history.

Most of this task's value came from the spec gate. Nine spec rounds ran **before
any product code existed** and produced seventeen findings — four would have
become data-correctness bugs, and two corrected premises stated as verified,
including a false claim that no durable database existed when the local docker
volume persists by design. Implementation review found three more.

`lib/format/businessDate.ts` is now the single place the business day is
decided. The SDD requires dates in the business timezone and never names it;
TASK-04 and TASK-06 deferred showing dates for that reason and TASK-10 then
rendered one in the browser's zone. The timezone is recorded as assumption A3
and isolated in one module. It interprets input as well as rendering output,
because changing only the formatter would have shifted valid date-only input
back a day. DST gaps move forward and overlaps resolve to the first occurrence.

Four limitations are carried forward, each pinned by a test: L1 the current
product name is shown with no snapshot, L2 no price exists to show, L3 rows
written before the parsing rule keep their instant, L4 forecast arithmetic is
fixed-duration and can display on the sale's own day for a backdated sale
crossing a DST transition.

The architecture-complexity signal fired for TASK-11 as well: nine review rounds
carrying confirmed findings against a threshold of five, computed from the loop
register rather than estimated. It is recorded as `ARCH-02` — consolidating the
domain's date and time contract — because the overwhelming majority of the
twenty corrections landed there rather than in the history feature itself. It is
non-blocking and does not reopen TASK-11.

**TASK-12 is not yet executable.** Its dependencies TASK-09 and TASK-11 are
satisfied, but `ARCH-01` — whether `expectedRepurchaseAt` should remain a
synchronously persisted derived field — must be resolved first, because a
repurchase dashboard is precisely the consumer that would couple to the current
persistence design. TASK-13 (dashboard de estoque) has its dependencies met and
carries no such block.
