# Recompra CRM — Rick Loop State

```yaml
schema_version: "1.1"
state_version: 78
project: RecompraCRM
roadmap: MVP-01
global_status: RUNNING
mode: CONTROLLED_AUTONOMOUS
loop_version: RICK_LOOP_V1_5
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
  - TASK-14
last_completed_task: TASK-14
task_12_closure_pr: 30 MERGED_SQUASH
task_12_closure_merge_main_head: a7734f4fc270db11933b7b0461625b4c00e6263b
current_task: TASK-14
current_task_status: COMPLETED
next_eligible_task: TASK-15
next_eligible_task_reason: ELIGIBLE_TASK_FOUND — ARCH-04 está COMPLETED (Stage 3, PR 41, merge 70c19d0, pós-merge Validate 35369010788 SUCCESS), então o depends_on de TASK-15 foi liberado; verificado ao vivo com resolveNextEligibleTask, que retorna TASK-15
branch: docs/ARCH-04-closure
pr_number: 42
task_14_spec_pr: 32 MERGED_SQUASH
task_14_spec_merge_main_head: ffdf8f9a994464e472bc92e4cb9b68e69bb44086
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
task_spec: docs/specs/TASK-14.md
arch_02_status: RESOLVED_MERGED
arch_02_pr: 31 MERGED_SQUASH
arch_02_merge_main_head: 51bfacf5e809c937de212a463f15a2c1d454ac81
arch_02_decision: OPTION_A_INSTANT_WITH_DECLARED_TIMEZONE_A3_ISOLATED
arch_02_decision_doc: docs/architecture/ARCH-02-decision.md
arch_02_schema_impact: none
arch_02_migration_impact: none
task_14_status: COMPLETED
task_14_spec: docs/specs/TASK-14.md
task_14_baseline: 51bfacf5e809c937de212a463f15a2c1d454ac81
task_14_spec_branch: docs/TASK-14-spec
task_14_spec_review_rounds_source: docs/operations/LOOP-REGISTER.jsonl
task_14_decision_dependency: ARCH-02_RESOLVED_OPTION_A
task_14_implementation_branch: feat/TASK-14-hardening
task_14_implementation_baseline: ffdf8f9a994464e472bc92e4cb9b68e69bb44086
task_14_implementation_pr: 34 MERGED_SQUASH
task_14_reviewed_head: b17c5b5a70ebf4a7965f670eef426ec17ef5c26b
task_14_review: CLAUDE_PR_REVIEW_CLEAN_ON_EXACT_HEAD
task_14_review_rounds: 2
task_14_merge_main_head: c990654d32e2acda56faead8b28b1b8da33ce644
task_14_main_ci_run: 35231964035
task_14_main_ci_status: SUCCESS
task_14_evidence: docs/evidence/TASK-14-validation.md
task_14_playwright: PASS_8_EPHEMERAL_RETRIES_0
task_14_guard: scripts/ui-hardening-check.mjs
task_14_blocks_next: ARCH-04 must resolve before TASK-15 (mechanically enforced via ROADMAP.md depends_on)
owner_decision_02: OWNER-02_REVIEW_TRIGGER_ECONOMICS
owner_decision_02_status: IMPLEMENTED_ARCH_04_CLOSED_REMAINDER_TRACKED_AS_ARCH_05
owner_decision_02_decided_at: "2026-09-17"
owner_decision_02_authorized_by: owner
owner_decision_02_note: granted in this session; no prior repository record of this decision existed before this entry, and none is claimed
owner_decision_02_scope: remove the automatic per-push Claude review dispatch (pull_request/synchronize trigger); the loop controller dispatches one independent review deterministically once READY_FOR_INDEPENDENT_REVIEW
owner_decision_02_forbids: weakening the mandatory clean-exact-HEAD independent review gate before merge; any manual @claude review command as a substitute
owner_decision_02_sequence: CI PASS -> authoritative validation PASS -> deterministic preflight PASS -> READY_FOR_INDEPENDENT_REVIEW -> one Claude review of the exact HEAD -> CLEAN -> merge; FINDINGS -> fix -> push -> CI and validation -> preflight -> one new independent review
owner_decision_02_includes: STATE_POINTER_CONSISTENCY, BASELINE_POINTER_CONSISTENCY, LOOP-REGISTER integrity, current_task vs next_eligible_task semantics, decide_before resolver gate, remote-first reconciliation, mechanical checks before LLM review, review usage metrics
owner_decision_02_includes_split: only decide_before resolver gate and mechanical checks before LLM review are implemented by ARCH-04; the other six items are tracked non-blocking as ARCH-05, so closing ARCH-04 does not silently close OWNER-02
owner_decision_02_next_action: NONE — ARCH-04 encerrado; o restante de OWNER-02 é ARCH-05, não bloqueante
owner_decision_02_roadmap_item: ARCH-04
owner_decision_02_roadmap_item_remainder: ARCH-05
owner_decision_02_roadmap_mechanism: TASK-15 depends_on now includes ARCH-04, so the deterministic resolver blocks TASK-15 until ARCH-04's status is RESOLVED/COMPLETED (currently SPEC_MERGED_IMPLEMENTING, previously SPEC_IN_REVIEW and before that AUTHORIZED_NOT_YET_IMPLEMENTED); a bare STATE/HANDOFF note is invisible to scripts/rick-loop-roadmap.mjs, which only models TASK-*/ARCH-* roadmap entries
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
task_12_main_ci_run: 32882137795
task_12_main_ci_status: SUCCESS
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
open_architecture_items: ARCH-03 (untracked: STATE-only reference, no ROADMAP.md entry, invisible to the resolver), ARCH-04 (tracked: real ROADMAP.md entry, gates TASK-15 via depends_on)
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
next_action: START_TASK-15
arch_04_spec_status: SPEC_MERGED
arch_04_spec: docs/specs/ARCH-04.md
arch_04_spec_pr: 36 MERGED_SQUASH
arch_04_spec_merge_main_head: 2f5c687b56e7dc48791d9323fd47f8ade842c4b0
arch_04_spec_review_rounds: 6
arch_04_spec_main_ci_run: 35257845976
arch_04_spec_main_ci_status: SUCCESS
arch_04_impl_branch: feat/ARCH-04-dispatch-activation — histórico; ARCH-04 encerrado
arch_04_impl_stage: COMPLETED
arch_04_pr1_status: 37 MERGED_SQUASH
arch_04_pr1_reviewed_head: 45ddde18a96f9e1ee0cd13cb0ae8fae42c505203
arch_04_pr1_review: CLAUDE_PR_REVIEW_CLEAN_ON_EXACT_HEAD
arch_04_pr1_review_rounds: 10
arch_04_pr1_merge_main_head: 3bb1ec1432911e6f35e71e49b8c2c415d5ca0fce
arch_04_blocker: CLAUDE_CODE_ACTION_WORKFLOW_VALIDATION_BLOCKS_REVIEW_OF_ITS_OWN_WORKFLOW_FILE
arch_04_blocker_evidence: run 35258611604 skipped with a green check and no verdict; precedent in PRs 27 and 28
arch_04_blocker_owner_decision: OPTION_1_SECONDARY_REVIEWER_STAGED
arch_04_blocker_owner_decision_at: "2026-09-17"
arch_04_bootstrap_stage1: add .github/workflows/claude-pr-review-meta.yml in an isolated PR reviewed by the primary reviewer, merged and post-merge validated
arch_04_bootstrap_stage2: cutover PR editing claude-pr-review.yml, reviewed by the secondary reviewer with a real exact-head verdict; a green check without a verdict is not sufficient and must stop the loop
arch_04_bootstrap_stage3: activate controller dispatch, then remove the automatic per-push trigger only once the replacement is operational
arch_04_bootstrap_stage4: acceptance proofs (multiple pushes trigger no review, one authorized HEAD produces one review, stale HEAD cannot invoke the model, workflow changes get a real review, findings revalidate, clean review merges only with all gates green)
arch_04_secondary_reviewer_scope: activates only for changes to the primary review workflow or explicitly authorized review-infrastructure maintenance, never for normal PRs
arch_04_stage1_status: 38 MERGED_SQUASH
arch_04_stage1_reviewed_head: ccc9c493829b0a438c36fecaf432da9feb140c78
arch_04_stage1_review: CLAUDE_PR_REVIEW_CLEAN_ON_EXACT_HEAD
arch_04_stage1_review_rounds: 3
arch_04_stage1_merge_main_head: f83b66868d792983267e5a49944466e7cb5e850f
arch_04_stage1_main_ci_run: 35342232305
arch_04_stage1_main_ci_status: SUCCESS
arch_04_pointer_gate_rationale: eight review rounds across PRs 36/37/38 caught the same fact updated in two of the three files that carry it; the gate replaces the discipline that failed eight times
arch_04_pointer_gate_position: before STAGE2, so the cutover PR does not land with the hole open
arch_04_pointer_gate_status: 39 MERGED_SQUASH
arch_04_pointer_gate_reviewed_head: f2d60a5754c8eec9c735eee55fecb82a97aa3aad
arch_04_pointer_gate_review: CLAUDE_PR_REVIEW_CLEAN_ON_EXACT_HEAD
arch_04_pointer_gate_review_rounds: 3
arch_04_pointer_gate_merge_main_head: f3fc47971acde296482c58e43fcd5982961c17e4
arch_04_pointer_gate_main_ci_run: 35344725337
arch_04_pointer_gate_main_ci_status: SUCCESS
arch_04_pointer_gate_ninth_occurrence: the gate's own PR was blocked by no_state_drift (HANDOFF current_branch/current_pr stale against STATE and the live PR) with CI green and the review clean on the exact HEAD - the first time the drift class was caught by a machine instead of a reviewer, and a demonstration that the fail-closed order holds even when every other gate is satisfied
arch_04_stage2_reviewer: SECONDARY_claude-pr-review-meta.yml
arch_04_stage2_requirement: a green check without a real exact-head verdict is NOT sufficient; if the secondary review fails or silently skips, stop and do not merge
arch_04_stage2_status: 40 MERGED_SQUASH
arch_04_stage2_review_rounds: 2
arch_04_stage2_reviewed_head: 1c969de9218d99dbd7450d3480aa0252aa995af8
arch_04_stage2_merge_main_head: 1a27df3
arch_04_stage2_main_ci_run: 35347958284
arch_04_stage2_main_ci_status: SUCCESS
arch_04_stage2_secondary_proof: secondary run 35347401663 ran 4m45s with num_turns 29, zero workflow-validation skip lines, and published Reviewed commit 1c969de; primary run 35347401649 finished in 12s logging "Exiting due to workflow validation skip" with no verdict - a green check that proves nothing, which is why the verdict was required and not the check
arch_04_stage2_p1_finding: dispatch ran the PR author's own workflow definition because --ref named the PR branch; fixed by dispatching the default branch and correlating runs via run-name
arch_04_stage2_gate_proof: evaluateMergeAllowed returned allowed:false on the first HEAD with zeroUnresolvedFindings:false while the secondary verdict said clean - the gate, not the reviewer, blocked the merge
arch_04_stage2_draft_first: the PR opened as a draft so its own pr_number could be recorded without triggering a review, then marked ready, producing one review on the final HEAD instead of two
next_action_authorized: true
updated_at: "2026-09-18T12:20:00Z"
updated_by: Claude Code (Rick Loop, ARCH-04 Stage 1b pointer gate)
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
ARCH-01 is resolved by Option A, so TASK-12 is no longer task-scoped blocked.
TASK-12 and TASK-13 are both completed and merged. ARCH-02 is resolved by
Option A. TASK-14 is completed and merged: spec PR #32, implementation PR
#34 (2 review rounds — round 1 caught embedded NUL bytes in the new guard
script that made it undiffable, plus a dead assertion), clean Claude review
on exact head `b17c5b5`, merged at `c990654` with post-merge Validate
`35231964035` SUCCESS. Round detail lives in
`docs/operations/LOOP-REGISTER.jsonl`, not in this narrative.

OWNER-02 (`REVIEW_TRIGGER_ECONOMICS`) was authorized by the owner on
2026-09-17: now that TASK-14 has closed, the automatic per-push Claude
review trigger is to be replaced with a controller-dispatched trigger fired
once `READY_FOR_INDEPENDENT_REVIEW` is reached. The mandatory clean-exact-HEAD
independent review before merge is unchanged and is not weakened by this
decision. It is tracked as `ARCH-04` in `docs/roadmap/ROADMAP.md`, and
TASK-15's `depends_on` names it, so the deterministic resolver reports
`NO_ELIGIBLE_TASK` rather than silently selecting TASK-15 until it resolves —
verified live against `scripts/rick-loop-roadmap.mjs` after TASK-14 was
checked off. No prior record of this decision existed in this repository
before this entry.
