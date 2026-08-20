# Rick Loop v1.3.2 — deterministic work selection and STATE/HANDOFF drift

Status: PROPOSED_IN_EXECUTABLE_GOVERNANCE_PR
Base: RICK_LOOP_V1_3_1
Pilot: Recompra CRM
Reason: live defects observed immediately after TASK-11 closure.

This amendment is allowed under v1.3 invariant 7 because the defects block autonomous execution and allow contradictory operational state to be reported as clean.

## H. Deterministic next-eligible-task resolution

After a numbered task closes, the controller must not trust `STATE.current_task` as proof that the pointed task is executable.

It must parse ROADMAP task metadata and evaluate pending numbered tasks in roadmap order. A task is eligible only when every explicit `depends_on` and `blocked_by` reference is resolved. Unknown references fail closed for that candidate.

An architecture signal remains globally non-blocking. However, when a numbered task explicitly names an architecture item in `depends_on` or `blocked_by`, that architecture item blocks only that numbered task until the item is resolved.

If the first pending task is blocked but a later task is eligible, the controller must select the later task automatically. It must not ask the owner merely because the earlier task is blocked.

If no pending task is eligible, the controller returns `NO_ELIGIBLE_TASK` with the blocker set. That state does not itself invent an owner-only decision; the executor must classify the actual unresolved blocker before escalating.

Canonical live case:

- TASK-12 depends on TASK-09, TASK-11 and ARCH-01 and is explicitly blocked by ARCH-01;
- ARCH-01 is open;
- TASK-13 depends only on completed TASK-06 and TASK-08;
- therefore the deterministic next eligible task is TASK-13.

The controller transition for a persisted pointer that still names a blocked task is `TASK_ADVANCE`, followed by the normal spec gate for the selected task.

## I. STATE/HANDOFF drift is a first-class invariant

`docs/operations/HANDOFF.md` is now read by the controller during reconciliation.

When both documents provide a pointer, contradictions between STATE and HANDOFF must produce `STATE_DRIFT_DETECTED` before implementation writes. At minimum the controller checks:

- `current_task`;
- `next_eligible_task`;
- execution `mode`;
- current branch pointer;
- current PR pointer.

The TASK-11 closure exposed the live defect: STATE had advanced to TASK-12 while HANDOFF still described TASK-10 closure and TASK-11 as current. The old controller returned `drift []` because it never read HANDOFF. v1.3.2 makes that impossible.

## Regression evidence required

The executable controller test must prove all of the following:

1. blocked TASK-12 + eligible TASK-13 => TASK-13;
2. resolved ARCH-01 => TASK-12 becomes eligible again;
3. every pending task blocked => `NO_ELIGIBLE_TASK`, never an invented task;
4. stale HANDOFF vs STATE => `STATE_DRIFT_DETECTED` inputs are emitted;
5. aligned HANDOFF/STATE => no false drift;
6. the current pilot selection produces `TASK_ADVANCE` to TASK-13 and then `SPEC_REQUIRED` for TASK-13 after the pointer is reconciled.

No product-domain behavior is changed by this amendment.
