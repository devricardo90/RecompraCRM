# Recompra CRM — Rick Loop State

```yaml
schema_version: "1.1"
state_version: 66
project: RecompraCRM
roadmap: MVP-01
global_status: RUNNING
mode: CONTROLLED_AUTONOMOUS
loop_version: RICK_LOOP_V1_4
loop_upgrade_01b_status: MERGED
loop_upgrade_02_status: MERGED_V1_3_FROZEN
loop_upgrade_02_merge_main_head: 44b1f3f0612ebf815f2cfbf261596dbbd3a2fbc6
loop_upgrade_02_validation: Validate #84 / 32257064941 SUCCESS
loop_upgrade_02_review_exception: CODEX_REQUESTED_3X_NO_PUBLISHED_REVIEW
loop_upgrade_03_status: MERGED_V1_3_2
loop_upgrade_03_pr: 18 MERGED_SQUASH
loop_upgrade_03_reviewed_head: 9ad5e1c855672de55604484e113d98872474d7a3
loop_upgrade_03_review: CODEX_REVIEW_CLEAN_ON_EXACT_HEAD
loop_upgrade_03_merge_main_head: ad2f7487f4fecc404fe310dacbeec018f4fe8d9a
loop_upgrade_03_validation: Validate #125 SUCCESS
loop_upgrade_04_status: MERGED_V1_3_3
loop_upgrade_04_pr: 23 MERGED_SQUASH
loop_upgrade_04_reviewed_head: 6047a8360156225ede01eb303c398257dca59b16
loop_upgrade_04_review: CODEX_REVIEW_CLEAN_ON_EXACT_HEAD
loop_upgrade_04_review_published_at: "2026-08-23T14:53:23Z"
loop_upgrade_04_merged_at: "2026-08-23T15:04:05Z"
loop_upgrade_04_review_before_merge: PROVEN_IN_LIVE_EXECUTION
loop_upgrade_04_review_rounds: 5
loop_upgrade_04_findings_fixed: 6
loop_upgrade_04_merge_main_head: 2b1e2f76c7b72e583fcfef84ee74b89b0ac5db44
loop_upgrade_04_main_ci_run: 32647380522
loop_upgrade_04_main_ci_status: SUCCESS
loop_finding_transient_wait: TRANSIENT_WAIT_NO_REENTRY
loop_finding_transient_wait_status: MERGED_V1_3_4
loop_finding_api_connection_loss_status_2: MERGED_V1_3_4
loop_upgrade_05_status: MERGED_V1_3_4
loop_upgrade_05_pr: 24 MERGED_SQUASH
loop_upgrade_05_reviewed_head: 804ab475e725a02068104eef7833b95765831049
loop_upgrade_05_review: CODEX_REVIEW_CLEAN_ON_EXACT_HEAD
loop_upgrade_05_review_published_at: "2026-08-23T15:59:06Z"
loop_upgrade_05_merged_at: "2026-08-23T17:42:09Z"
loop_upgrade_05_review_before_merge: PROVEN_IN_LIVE_EXECUTION
loop_upgrade_05_review_rounds: 7
loop_upgrade_05_merge_main_head: b72670fec890d1687a5f69e1e544ce38cd8f4d0e
loop_upgrade_05_main_ci_run: 32655684084
loop_upgrade_05_main_ci_status: SUCCESS
loop_finding_api_connection_loss: API_CONNECTION_LOSS_NO_REENTRY
loop_finding_api_connection_loss_status: MERGED_V1_3_4
loop_governance_v134_pr: 24
loop_governance_v134_branch_ci: 32647772120 SUCCESS
loop_governance_architecture_signal: ARCHITECTURE_COMPLEXITY_SIGNAL_ACTIVE
loop_governance_architecture_item: ARCH-03
loop_governance_review_rounds_at_8427dbe: 7
loop_governance_review_rounds_source: derived from docs/operations/LOOP-REGISTER.jsonl
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
  - TASK-12
  - TASK-13
last_completed_task: TASK-12
current_task: TASK-12
current_task_status: COMPLETED
next_eligible_task: TASK-12
branch: feat/TASK-12-repurchase-dashboard-impl
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
task_12_spec_status: SPEC_MERGED
task_12_spec_review_rounds_source: docs/operations/LOOP-REGISTER.jsonl
task_12_spec_rereview_status: UNBLOCKED_REVIEWER_CHANGED_TO_CLAUDE_PR_REVIEW
task_12_spec_rereview_provider: CLAUDE_CODE_ACTION
task_12_spec_rereview_attempts: 4
task_12_spec_rereview_first_refusal: "2026-08-23T18:03:20Z"
task_12_spec_rereview_last_refusal: "2026-08-23T19:24:26Z"
task_12_branch_ci_run: 32657266070
task_12_branch_ci_status: SUCCESS
task_12_unresolved_findings: 0
task_12_owner_decision: OWNER-01_DASHBOARD_ROW_GRANULARITY
task_12_owner_decision_status: RESOLVED_OPTION_A
task_12_owner_decision_resolution: OPTION_A_ONE_ROW_PER_SALE_ITEM
task_12_owner_decision_invariant: sale_item_to_forecast_to_forecast_date_to_bucket
task_12_owner_decision_forbids: customer_level_aggregation, representative_date_rules
task_12_owner_decision_decided_at: "2026-08-23"
task_12_owner_decision_blocks: none
task_12_baseline: 27b3959c7394b030e9f5639abd368a1c12f55516
task_12_schema_delta: additive_index_saleitem_expectedrepurchaseat
task_12_inherited_limitation: L4
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
task_12_status: COMPLETED
task_12_reviewed_head: 43bd46c6c2dd6f567817dbfb59e37aada4cc98ad
task_12_review: CLAUDE_PR_REVIEW_CLEAN_ON_EXACT_HEAD
task_12_review_provider: CLAUDE_CODE_ACTION
task_12_impl_review_rounds: 3
task_12_branch_ci: 32881510184 SUCCESS
task_12_merge_main_head: 6a8b12d043bae15450e4da44184c2c1d5c355597
task_12_spec_pr: 25 MERGED_SQUASH
task_12_impl_pr: 29
task_12_spec_merge_main_head: 27b3959c7394b030e9f5639abd368a1c12f55516
task_12_impl_branch: feat/TASK-12-repurchase-dashboard-impl
task_12_impl_baseline: 27b3959c7394b030e9f5639abd368a1c12f55516
task_12_migration: prisma/migrations/20260825140000_index_sale_item_expected_repurchase
task_12_evidence: docs/evidence/TASK-12-validation.md
task_12_blocked_by: none
task_12_decision_dependency: ARCH-01_RESOLVED_OPTION_A
task_13_status: COMPLETED_MERGED
task_13_dependencies: TASK-06, TASK-08
task_13_selection_reason: FIRST_PENDING_ELIGIBLE_AFTER_TASK_12_BLOCKED_BY_ARCH_01
task_13_technical_head: fc75538
task_13_local_validation: PASS
task_13_playwright: PASS_12_EPHEMERAL_RETRIES_0
task_13_reviewed_head: 143d33b0fadac6058c023acad5aa6d708f919677
task_13_review: CODEX_REVIEW_CLEAN_ON_EXACT_HEAD
task_13_review_record: 5001957796 COMMENTED_NO_FINDINGS
task_13_pr: 20 MERGED_SQUASH
task_13_merge_main_head: e36710799d8423752bed8b3e8ec4edd18191ef26
task_13_branch_ci_run: 32627221744
task_13_branch_ci_status: SUCCESS
task_13_main_ci_run: 32627428431
task_13_main_ci_status: SUCCESS
task_13_merge_order_discrepancy: MERGED_2026-08-23T08:07:49Z_BEFORE_REVIEW_2026-08-23T08:08:44Z
task_13_local_reconciliation_commit: 98a40e1
arch_01_status: RESOLVED
arch_01_decision: OPTION_A_PERSISTED_SYNCHRONOUS_TRIGGER_OWNED_FORECAST
arch_01_decision_doc: docs/architecture/ARCH-01-decision.md
arch_01_schema_impact: NONE
arch_01_migration_impact: NONE
open_architecture_items: ARCH-02, ARCH-03
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
working_tree: clean_except_preserved_untracked_claude_settings
next_action: RUN_RESOLVER_FOR_NEXT_TASK
next_action_authorized: true
updated_at: "2026-08-25T18:15:00Z"
updated_by: ChatGPT Control Plane
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

Rick Loop v1.3.2 is merged in `main` at `ad2f7487f4fecc404fe310dacbeec018f4fe8d9a`
and passed post-merge Validate #125. Its deterministic resolver evaluates the
pending roadmap entries rather than trusting the persisted task pointer.
ARCH-01 is resolved by Option A, so TASK-12 is no longer task-scoped blocked;
TASK-13 is completed and merged. TASK-12 is the deterministic next task and its
spec is in review on PR #25. Round detail lives in
`docs/operations/LOOP-REGISTER.jsonl`, not in this narrative.
