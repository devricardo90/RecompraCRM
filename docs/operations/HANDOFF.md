# Recompra CRM — Current Handoff

```yaml
schema_version: "1.1"
run_id: RCRM-MVP01-RUN-004
loop_id: RCRM-TASK10-CLOSURE
status: TASK_10_COMPLETED_READY_FOR_TASK_11
mode: CONTROLLED_AUTONOMOUS
loop_version: RICK_LOOP_V1_3_1
current_task: TASK-11
current_task_status: NOT_STARTED
next_eligible_task: TASK-11
current_branch: main
current_pr: none
external_gate: none
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
task_10_architecture_signal: NOT_EMITTED_4_OF_5_ROUNDS
task_10_evidence: docs/evidence/TASK-10-validation.md
open_architecture_item: ARCH-01 (decide before TASK-12)
next_action: START_TASK_11
next_action_authorized: true
human_intermediate_approval_required: false
restart_command: git switch main && git pull --ff-only && npm install
```

## Resume order

1. Confirm `main` is at `f69f4e13666b0740f0952fcf17148da4d6cda2cd` and Validate `32291852224` is SUCCESS.
2. Derive `docs/specs/TASK-11.md` from the SDD and the roadmap before writing
   code.
3. Create `feat/TASK-11-customer-history` from `main`, verify a green baseline,
   take a pre-write checkpoint, then implement.
4. TASK-11 changes UI, so the ephemeral Playwright run is required.

## Contracts TASK-11 inherits

- **Any write to `Sale`/`SaleItem` must go through
  `lib/sales/saleTransaction.ts`.** It owns the deterministic write shape and
  the bounded retry policy. Reimplementing either reopens TASK-09's residual,
  and the concurrency harness asserts the emitted statement shape, so a
  divergent writer will not go unnoticed.
- `expectedRepurchaseAt` is database-derived. Never send it, never compute it.
- Domain invariants are reported, not reimplemented: `23514`, `23503`, `P2003`
  and `22003` map to readable 4xx; only `40P01`, `40001` and `P2034` are
  retryable.
- Node `>=24.0.0` is required — the concurrency harness imports the production
  TypeScript module directly and relies on native type stripping.

## Open, non-blocking

`ARCH-01` — whether `expectedRepurchaseAt` should remain a synchronously
persisted derived field maintained by triggers. TASK-09 emitted
`ARCHITECTURE_COMPLEXITY_SIGNAL` (7 rounds). TASK-10 came within one round of
the threshold (4 of 5), with most findings clustered around the error
classification and write shape that the persisted forecast demands. Decide
before TASK-12 couples a dashboard to the current design. It does not reopen
TASK-09 or TASK-10.
