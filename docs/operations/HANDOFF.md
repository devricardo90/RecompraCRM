# Recompra CRM — Current Handoff

```yaml
schema_version: "1.1"
run_id: RCRM-MVP01-RUN-013
loop_id: RCRM-V14-TASK14-RECOVERY-AFTER-SHUTDOWN
status: TASK_14_CLOSED_BLOCKED_ON_ARCH_04
mode: CONTROLLED_AUTONOMOUS
loop_version: RICK_LOOP_V1_4
current_task: TASK-14
current_task_status: COMPLETED
next_eligible_task: none
next_eligible_task_reason: NO_ELIGIBLE_TASK — TASK-15 depends_on ARCH-04, status SPEC_MERGED_IMPLEMENTING (spec merged on PR 36; implementation PR 37 open - not yet RESOLVED/COMPLETED); verified live via scripts/rick-loop-roadmap.mjs
current_branch: feat/ARCH-04-review-dispatch
current_pr: 37
task_14_spec_pr: 32 MERGED_SQUASH
task_14_spec_merge_main_head: ffdf8f9a994464e472bc92e4cb9b68e69bb44086
task_14_implementation_pr: 34 MERGED_SQUASH
task_14_reviewed_head: b17c5b5a70ebf4a7965f670eef426ec17ef5c26b
task_14_review: CLAUDE_PR_REVIEW_CLEAN_ON_EXACT_HEAD
task_14_review_rounds: 2
task_14_merge_main_head: c990654d32e2acda56faead8b28b1b8da33ce644
task_14_main_ci: Validate 35231964035 SUCCESS
task_14_evidence: docs/evidence/TASK-14-validation.md
task_14_playwright: PASS_8_EPHEMERAL_RETRIES_0
owner_decision_02: OWNER-02_REVIEW_TRIGGER_ECONOMICS
owner_decision_02_status: AUTHORIZED_NOT_YET_IMPLEMENTED
owner_decision_02_decided_at: "2026-09-17"
owner_decision_02_scope: remove the automatic per-push Claude review dispatch; controller dispatches one independent review deterministically once READY_FOR_INDEPENDENT_REVIEW; the mandatory clean-exact-HEAD review before merge is unchanged
owner_decision_02_next_action: AWAIT_ARCH_04_PR1_REVIEW_THEN_BOOTSTRAP_STAGE1
owner_decision_02_roadmap_item_remainder: ARCH-05
owner_decision_02_roadmap_item: ARCH-04
external_gate: none
loop_upgrade_pr: 18 MERGED_SQUASH
loop_upgrade_reviewed_head: 9ad5e1c855672de55604484e113d98872474d7a3
loop_upgrade_review: CODEX_REVIEW_CLEAN_ON_EXACT_HEAD
loop_upgrade_merge_main_head: ad2f7487f4fecc404fe310dacbeec018f4fe8d9a
loop_upgrade_main_ci: Validate #125 SUCCESS
loop_governance_pr: 23 MERGED_SQUASH
loop_governance_reviewed_head: 6047a8360156225ede01eb303c398257dca59b16
loop_governance_review: CODEX_REVIEW_CLEAN_ON_EXACT_HEAD
loop_governance_review_before_merge: PROVEN_IN_LIVE_EXECUTION
loop_governance_merge_main_head: 2b1e2f76c7b72e583fcfef84ee74b89b0ac5db44
loop_governance_main_ci: Validate 32647380522 SUCCESS
loop_finding_closed: TRANSIENT_WAIT_NO_REENTRY
loop_finding_closed_2: API_CONNECTION_LOSS_NO_REENTRY
loop_governance_v134_pr: 24 MERGED_SQUASH
loop_governance_v134_merge_main_head: b72670fec890d1687a5f69e1e544ce38cd8f4d0e
loop_governance_v134_main_ci: Validate 32655684084 SUCCESS
task_11_status: COMPLETED
task_11_pr: 17 MERGED_SQUASH
task_11_main_ci: Validate 32370638624 SUCCESS
task_12_status: COMPLETED
task_12_reviewed_head: 43bd46c6c2dd6f567817dbfb59e37aada4cc98ad
task_12_review: CLAUDE_PR_REVIEW_CLEAN_ON_EXACT_HEAD
task_12_merge_main_head: 6a8b12d043bae15450e4da44184c2c1d5c355597
task_12_main_ci: Validate 32882137795 SUCCESS
task_12_spec_pr: 25 MERGED_SQUASH
task_12_impl_pr: 29
task_12_spec_merge_main_head: 27b3959c7394b030e9f5639abd368a1c12f55516
task_12_spec_review_rounds_source: docs/operations/LOOP-REGISTER.jsonl
task_12_blocked_by: none
task_12_decision_dependency: ARCH-01_RESOLVED_OPTION_A
task_12_spec: docs/specs/TASK-12.md (merged; implementation merged)
task_12_owner_decision: OWNER-01 dashboard row granularity — one row per sale item (A) vs one row per customer (B)
task_12_owner_decision_status: RESOLVED_OPTION_A
task_12_owner_decision_resolution: A — one dashboard row per sale item; customer aggregation and representative-date rules are forbidden in this task
task_13_status: COMPLETED_MERGED
task_13_dependencies: TASK-06, TASK-08
task_13_selection_reason: FIRST_PENDING_ELIGIBLE_AFTER_TASK_12_BLOCKED_BY_ARCH_01
task_13_spec: docs/specs/TASK-13.md
task_13_technical_head: fc75538
task_13_local_validation: PASS
task_13_playwright: PASS_12_EPHEMERAL_RETRIES_0
task_13_reviewed_head: 143d33b0fadac6058c023acad5aa6d708f919677
task_13_review: CODEX_REVIEW_CLEAN_ON_EXACT_HEAD
task_13_review_record: 5001957796 COMMENTED_NO_FINDINGS
task_13_pr: 20 MERGED_SQUASH
task_13_merge_main_head: e36710799d8423752bed8b3e8ec4edd18191ef26
task_13_branch_ci: Validate 32627221744 SUCCESS
task_13_main_ci: Validate 32627428431 SUCCESS
task_13_merge_order_discrepancy: MERGE_PRECEDED_EXACT_HEAD_REVIEW_BY_55_SECONDS
task_13_local_reconciliation_commit: 98a40e1 PRESERVED_ON_recovery/TASK13-98a40e1
arch_01_status: RESOLVED
arch_01_decision: OPTION_A_PERSISTED_SYNCHRONOUS_TRIGGER_OWNED_FORECAST
arch_01_decision_doc: docs/architecture/ARCH-01-decision.md
arch_02_status: RESOLVED
arch_02_decision: OPTION_A_INSTANT_WITH_DECLARED_TIMEZONE_A3_ISOLATED
arch_02_decision_doc: docs/architecture/ARCH-02-decision.md
open_architecture_items: ARCH-03 (untracked: STATE-only reference, no ROADMAP.md entry, invisible to the resolver), ARCH-04 (tracked: real ROADMAP.md entry, gates TASK-15 via depends_on)
next_action: AWAIT_ARCH_04_PR1_REVIEW_THEN_BOOTSTRAP_STAGE1
arch_04_spec_status: SPEC_MERGED
arch_04_spec: docs/specs/ARCH-04.md
arch_04_spec_pr: 36 MERGED_SQUASH
arch_04_spec_merge_main_head: 2f5c687b56e7dc48791d9323fd47f8ade842c4b0
arch_04_impl_branch: feat/ARCH-04-review-dispatch
arch_04_impl_stage: PR1_SCRIPTS_ONLY_WORKFLOW_FILE_DEFERRED
arch_04_blocker: CLAUDE_CODE_ACTION_WORKFLOW_VALIDATION_BLOCKS_REVIEW_OF_ITS_OWN_WORKFLOW_FILE
arch_04_blocker_owner_decision: OPTION_1_SECONDARY_REVIEWER_STAGED
arch_04_blocker_owner_decision_at: "2026-09-17"
arch_04_bootstrap_stage1: add .github/workflows/claude-pr-review-meta.yml in an isolated PR reviewed by the primary reviewer, merged and post-merge validated
arch_04_bootstrap_stage2: cutover PR editing claude-pr-review.yml, reviewed by the secondary reviewer with a real exact-head verdict; a green check without a verdict is not sufficient and must stop the loop
arch_04_bootstrap_stage3: activate controller dispatch, then remove the automatic per-push trigger only once the replacement is operational
arch_04_bootstrap_stage4: acceptance proofs (multiple pushes trigger no review, one authorized HEAD produces one review, stale HEAD cannot invoke the model, workflow changes get a real review, findings revalidate, clean review merges only with all gates green)
arch_04_secondary_reviewer_scope: activates only for changes to the primary review workflow or explicitly authorized review-infrastructure maintenance, never for normal PRs
next_action_authorized: true
human_intermediate_approval_required: false
restart_command: git switch main && git pull --ff-only && npm install
```

## Resume order

1. Confirm `main` contains TASK-14 at `c990654d32e2acda56faead8b28b1b8da33ce644` and post-merge Validate `35231964035` is SUCCESS.
2. TASK-14 is completed and merged: spec PR #32, implementation PR #34 (2
   review rounds), clean Claude review on exact head `b17c5b5`.
3. The deterministic resolver reports `NO_ELIGIBLE_TASK`: TASK-15
   `depends_on` now names `ARCH-04`, whose status is `SPEC_MERGED_IMPLEMENTING` (spec
   PR #36) — still not `RESOLVED`/`COMPLETED`, so TASK-15 stays blocked.
   This was verified live by running `scripts/rick-loop-roadmap.mjs`'s
   `resolveNextEligibleTask` against `docs/roadmap/ROADMAP.md` after
   checking TASK-14 off, not asserted from memory.
4. ARCH-04 is OWNER-02 (`REVIEW_TRIGGER_ECONOMICS`), authorized 2026-09-17:
   replace the automatic per-push Claude review trigger with a
   controller-dispatched one fired once `READY_FOR_INDEPENDENT_REVIEW`. The
   mandatory clean-exact-HEAD independent review before merge is unchanged.
   Its spec merged on PR #36 (`docs/specs/ARCH-04.md`, 6 review rounds,
   round detail in `docs/operations/LOOP-REGISTER.jsonl` under
   `run_id: RCRM-MVP01-RUN-014`); implementation PR #37 carries the
   scripts half and is in review — the same pipeline every other
   loop/governance change in this repo has gone through.
5. OWNER-01 stays resolved as Option A for TASK-12: one dashboard row per
   sale item. It binds nothing in TASK-14 or ARCH-04.
6. Review round detail is read from `docs/operations/LOOP-REGISTER.jsonl`,
   never from a status label.

## Why the loop is stopped here, not at TASK-15

TASK-12, TASK-13 and TASK-14 are completed and merged. Three of the
seventeen `TASK-*` entries remain (TASK-15/16/17) — the "17" in TASK-17's
`17/17 tasks verificadas` closure criterion counts tasks only. `ARCH-04` is
also open, and unlike `ARCH-03` it exists as a real `ROADMAP.md` entry with
`depends_on` wired onto TASK-15: it is deliberately a mechanical blocker,
not just a `decide_before` note in prose, because a bare STATE/HANDOFF
mention (which is all `ARCH-03` has — it has no `ROADMAP.md` entry) is
invisible to the deterministic resolver, which only models `TASK-*`/`ARCH-*`
roadmap entries. Without that wiring the loop would silently select TASK-15
next and the owner-authorized review-trigger change would never get done.
`ARCH-03` remains exactly the untracked, resolver-invisible reference this
paragraph is warning against — it is not fixed by this closure.

`NO_ELIGIBLE_TASK` is one of `rick-loop-controller.mjs`'s
`TERMINAL_TRANSITIONS`: a fresh, unattended run of the controller stops
here rather than inventing work — `scripts/rick-loop-controller-check.mjs`
asserts this ("all-blocked roadmap must not invent a task") as a
deliberate safety invariant, not a gap. Resuming past it requires a human
or an agent reading this handoff to drive the ARCH-04 spec/implementation
by hand — as of this entry that work is already underway (PR #36,
`SPEC_MERGED_IMPLEMENTING`) rather than unstarted — the same way OWNER-01 and
OWNER-02 themselves required an explicit owner decision the loop could not
make on its own. Giving the controller a
mechanical way to select and execute an open `ARCH-*` item is itself one
of the items `ARCH-04`'s own scope already lists (`decide_before resolver
gate`) — it is not bundled into this closure.

## Contracts TASK-14 leaves behind

TASK-14 added `scripts/ui-hardening-check.mjs` as a permanent regression
guard (wired into `npm test` and `validate.yml`) and `app/not-found.tsx` as
the project's malformed-route boundary. Any new screen must be added to the
guard's known-routes list or `test:ui-hardening` fails by design (AC14).
Full disposition in `docs/evidence/TASK-14-validation.md`.

It inherited the TASK-12 nullable-phone contract (AC21) and ARCH-02's date
contract (Option A, unchanged, not reopened). ARCH-03 stays open,
non-blocking, and authorises no refactor.

The contracts TASK-13 inherited are history and live with that task, in
`docs/specs/TASK-13.md` and `docs/evidence/TASK-13-validation.md`.

## ARCH-04 — REVIEW_TRIGGER_ECONOMICS (in progress: spec in review)

Authorized by the owner on 2026-09-17, recorded fresh with no prior
repository trace claimed or invented. Scope: remove the automatic per-push
Claude review dispatch and have the loop controller/watcher dispatch one
independent review deterministically, via `workflow_dispatch` with
exact-HEAD verification, once CI + authoritative validation + deterministic
preflight all pass. The mandatory clean-exact-HEAD independent review
before merge, and the FINDINGS → fix → push → CI/validation/preflight →
new review cycle, are unchanged.

Spec is `docs/specs/ARCH-04.md`, merged on PR #36 (round detail in
`docs/operations/LOOP-REGISTER.jsonl`, `run_id: RCRM-MVP01-RUN-014`).
Of the eight `owner_decision_02_includes` items, this spec implements only
the two the dispatch mechanism itself requires — the `decide_before`
resolver gate (already closed via `ARCH-04`'s `depends_on` on TASK-15) and
mechanical checks before LLM review (`rick-loop-preflight.mjs`). The other
six — STATE/BASELINE pointer consistency beyond what that preflight covers,
full LOOP-REGISTER integrity, `current_task`/`next_eligible_task` semantics
beyond `resolveEffectiveTask`, remote-first reconciliation, and review
usage metrics — are tracked separately as `ARCH-05`, non-blocking, so
closing `ARCH-04` does not silently close `OWNER-02`.
