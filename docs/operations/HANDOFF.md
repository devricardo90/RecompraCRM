# Recompra CRM — Current Handoff

```yaml
schema_version: "1.1"
run_id: RCRM-MVP01-RUN-003
loop_id: RCRM-TASK09-V1.3-CLOSURE
status: TASK_09_COMPLETED_READY_FOR_TASK_10
mode: CONTROLLED_AUTONOMOUS
loop_version: RICK_LOOP_V1_3
current_task: TASK-10
current_task_status: NOT_STARTED
next_eligible_task: TASK-10
current_branch: main
current_pr: none
external_gate: none
task_09_status: COMPLETED
task_09_technical_head: 82c68a7e6c73a0f141a2c8b30ae7d7632b750dee
task_09_branch_ci: 32274791956
task_09_review: CODEX_REVIEW_CLEAN_ON_EXACT_HEAD
task_09_review_rounds: 9
task_09_pr: 14 MERGED_SQUASH
task_09_merge_main_head: e4de101bcbd9d632a72c6a81efb3cf02a7cf0c8d
task_09_main_ci_run: 32282972720
task_09_main_ci_status: SUCCESS
task_09_spec: docs/specs/TASK-09.md
task_09_evidence: docs/evidence/TASK-09-validation.md
task_09_accepted_residual: RETRYABLE_40P01_ON_MULTI_ITEM_SALEITEM_STATEMENTS
task_09_architecture_signal: ARCHITECTURE_COMPLEXITY_SIGNAL
task_09_architecture_item: ARCH-01
task_10_spec: docs/specs/TASK-10.md
lessons_created:
  - LESSON-RCRM-0010
  - LESSON-RCRM-0011
  - LESSON-RCRM-0012
  - LESSON-RCRM-0013
  - LESSON-RCRM-0014
  - LESSON-RCRM-0015
  - LESSON-RCRM-0016
next_action: START_TASK_10
next_action_authorized: true
human_intermediate_approval_required: false
restart_command: git switch main && git pull --ff-only && npm install
```

## Resume order

1. Confirm `main` is at `e4de101bcbd9d632a72c6a81efb3cf02a7cf0c8d` and the Validate run `32282972720` is SUCCESS.
2. Read `docs/specs/TASK-10.md`, especially the binding concurrency contract —
   the strategy must be chosen and written into the spec before implementing,
   and proven with a concurrency test.
3. Create `feat/TASK-10-sale-registration-ui` from `main`, validate the
   baseline is green, take a pre-write checkpoint, then implement.
4. TASK-10 changes UI, so the ephemeral Playwright run is required this time —
   it was not applicable to TASK-09.
5. Do not reopen TASK-09 findings. They are fixed and recorded in
   `docs/operations/LESSONS.md` (LESSON-RCRM-0009..0016).

## TASK-09 closure

TASK-09 persists a per-SaleItem repurchase forecast using the canonical
formula, computed and maintained entirely in the persistence layer. Nine
independent review rounds hardened its concurrency behaviour against TASK-07's
item guard and TASK-08's stock reconciliation; eleven findings were confirmed
and fixed, and the final review of the exact head `82c68a7e6c73a0f141a2c8b30ae7d7632b750dee` reported no major
issues. PR #14 was squash-merged at `e4de101bcbd9d632a72c6a81efb3cf02a7cf0c8d` and the post-merge Validate run
`32282972720` is SUCCESS.

Carried forward deliberately, not hidden:

- **Accepted residual.** The lock ordering is a per-row guarantee, so a
  multi-item SaleItem statement or transaction can still produce a retryable
  `40P01`. No current application path issues one. TASK-10's spec carries a
  binding contract to settle this before implementation.
- **Architecture signal.** Nine review rounds with distinct confirmed defects
  emitted `ARCHITECTURE_COMPLEXITY_SIGNAL`, recorded as the non-blocking
  roadmap item `ARCH-01`: whether `expectedRepurchaseAt` should remain a
  synchronously persisted derived field. It must be decided before TASK-12
  couples a dashboard to the current design. It does not reopen TASK-09.
