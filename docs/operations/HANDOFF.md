# Recompra CRM — Current Handoff

```yaml
schema_version: "1.1"
run_id: RCRM-MVP01-RUN-005
loop_id: RCRM-V132-POST-MERGE-RECONCILIATION
status: TASK_13_SPEC_REQUIRED
mode: CONTROLLED_AUTONOMOUS
loop_version: RICK_LOOP_V1_3_2
current_task: TASK-13
current_task_status: SPEC_REQUIRED
next_eligible_task: TASK-13
current_branch: main
current_pr: none
external_gate: none
loop_upgrade_pr: 18 MERGED_SQUASH
loop_upgrade_reviewed_head: 9ad5e1c855672de55604484e113d98872474d7a3
loop_upgrade_review: CODEX_REVIEW_CLEAN_ON_EXACT_HEAD
loop_upgrade_merge_main_head: ad2f7487f4fecc404fe310dacbeec018f4fe8d9a
loop_upgrade_main_ci: Validate #125 SUCCESS
task_11_status: COMPLETED
task_11_pr: 17 MERGED_SQUASH
task_11_main_ci: Validate 32370638624 SUCCESS
task_12_status: BLOCKED_BY_ARCH_01
task_12_blocked_by: ARCH-01
task_13_status: SPEC_REQUIRED
task_13_dependencies: TASK-06, TASK-08
task_13_selection_reason: FIRST_PENDING_ELIGIBLE_AFTER_TASK_12_BLOCKED_BY_ARCH_01
task_13_spec: docs/specs/TASK-13.md
open_architecture_items: ARCH-01, ARCH-02
next_action: CREATE_TASK_13_SPEC
next_action_authorized: true
human_intermediate_approval_required: false
restart_command: git switch main && git pull --ff-only && npm install
```

## Resume order

1. Confirm `main` contains Rick Loop v1.3.2 at `ad2f7487f4fecc404fe310dacbeec018f4fe8d9a` and post-merge Validate #125 is SUCCESS.
2. Treat TASK-12 as task-scoped blocked by ARCH-01; do not stop the roadmap because TASK-13 is independently eligible.
3. Derive `docs/specs/TASK-13.md` from the SDD and TASK-13 roadmap contract before any product-code write.
4. Create `feat/TASK-13-stock-dashboard` from the verified green baseline, take the pre-write checkpoint, implement, validate, open PR, wait for CI, obtain exact-HEAD independent review, then merge only if clean.
5. After TASK-13 completion, re-run the deterministic resolver. TASK-12 remains blocked until ARCH-01 is resolved; do not infer an owner-only gate unless the architecture decision itself proves one is required.

## Why TASK-13 is selected

TASK-12 depends on TASK-09, TASK-11 and ARCH-01 and explicitly names ARCH-01 as its blocker. ARCH-01 is still OPEN. Rick Loop v1.3.2 therefore blocks TASK-12 only, not the roadmap.

TASK-13 depends on TASK-06 and TASK-08. Both are completed, and TASK-13 has no explicit blocker. It is therefore the first pending eligible task under the deterministic resolver.

## Contracts TASK-13 inherits

- Stock changes caused by a sale remain owned by the existing atomic sale/stock transaction path from TASK-08; the dashboard is a reader and must not invent a second stock mutation path.
- Product and stock UI behavior from TASK-06 is the baseline for stock semantics, including current stock and minimum stock.
- The dashboard must update after completed sales using repository/database truth; no duplicated client-side source of truth.
- No ARCH-01/ARCH-02 refactor belongs to TASK-13. Both architecture items remain separate and non-blocking for this task.
