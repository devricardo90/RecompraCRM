# Recompra CRM — Current Handoff

```yaml
schema_version: "1.1"
run_id: RCRM-MVP01-RUN-003
loop_id: RCRM-TASK09-V1.3-RECOVERY
status: WAIT_REVIEW
mode: CONTROLLED_AUTONOMOUS
loop_version: RICK_LOOP_V1_3
current_task: TASK-09
current_task_status: WAIT_REVIEW
current_pr: 14
current_branch: feat/TASK-09-repurchase-forecast
last_reviewed_head: e3be67a1d1cff634798ddaa59de6be16038be23d
last_reviewed_ci_run: 32258132550
last_reviewed_ci_status: SUCCESS
round2_findings_status: REVIEW_CLOSED_NO_LONGER_REPORTED
round3_findings: 2 P1 lock-order deadlock cycles
round3_findings_status: FIXED_CI_GREEN_AWAITING_INDEPENDENT_REVIEW
round3_head: e7cfff0980954bab06db5da5ebe98e0050083904
round3_ci_run: 32263724994
round3_ci_status: SUCCESS
evidence: docs/evidence/TASK-09-validation.md
task_spec: docs/specs/TASK-09.md
loop_upgrade_02_main_head: 44b1f3f0612ebf815f2cfbf261596dbbd3a2fbc6
loop_upgrade_02_status: MERGED_V1_3_FROZEN
next_action: WAIT_FOR_INDEPENDENT_REVIEW_OF_e7cfff09
human_intermediate_approval_required: false
```

## Resume order

1. Inspect PR #14 and confirm the current head is the round-3 lock-order fix.
2. Confirm the Validate run for that exact head is SUCCESS.
3. Obtain an independent review for that exact head. Do not describe the
   round-3 P1s as review-closed until that happens.
4. If review finds a real defect, stay in RECOVERING, fix only that finding,
   reset stagnation on real progress, validate, and review again.
5. If review is clean, reconcile evidence/STATE/HANDOFF/ROADMAP, merge PR #14,
   validate `main`, then mark TASK-09 COMPLETED and release TASK-10.

## Round-3 recovery (this loop)

The review that landed on `e3be67a` — the exact PR head, CI green — reported
two new P1 deadlock cycles rather than clearing the branch:

- `Product <-> SaleItem`: consumptionDays propagation vs the forecast read plus
  TASK-08 stock reconciliation.
- `Sale <-> SaleItem`: soldAt propagation vs the forecast read plus TASK-07's
  "at least one item" guard.

Neither is fixable by reordering row locks — in both, the parent row is already
held by the statement whose AFTER trigger propagates, and the child row by the
statement whose BEFORE trigger reads the parent. The child->parent direction
belongs to TASK-07/08 and stays.

`prisma/migrations/20260819140000_serialize_forecast_lock_order` therefore stops
the two *directions* from overlapping: a statement-level BEFORE trigger takes
one transaction-scoped advisory lock before any row lock — shared for SaleItem
writes, exclusive for the two propagating parent statements. Only `UPDATE OF`
the propagating column arms the exclusive lock, so TASK-08 stock updates and the
TASK-07 guard never attempt a shared->exclusive upgrade.

A plain global mutex was tried first and rejected: it removed the deadlocks but
serialized whole transactions and deadlocked the TASK-07 harness case where two
transactions must both delete an item before either commits. That failure is
why the shipped design is a shared/exclusive split.

`scripts/sale-forecast-lock-order-check.mjs` (wired into
`test:repurchase-forecast`, therefore into Validate) reproduces both cycles on a
database built from the migrations preceding the fix, then requires the
identical interleavings to commit once the fix is deployed. All local gates are
green, including the previously hanging `test:sale`. The fix is pushed as
`e7cfff0980954bab06db5da5ebe98e0050083904`; Validate `32263724994` is SUCCESS on
that exact head and an independent review of it was requested.

The v1.3 controller, task-level SDD, anti-drift reconciliation and recovery
policy are part of this branch. TASK-09 was resumed, not restarted.
