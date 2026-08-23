# Rick Loop v1.3.4 amendment — WAIT_* states are non-terminal

```yaml
amendment: RICK_LOOP_V1_3_4
status: PROPOSED_ON_PR
finding: TRANSIENT_WAIT_NO_REENTRY
finding_2: API_CONNECTION_LOSS_NO_REENTRY
supersedes_status_of: RICK_LOOP_V1_3_3
```

## Finding

A transient `WAIT_CI` / `WAIT_FOR_CODEX` state ended the autonomous run instead
of re-entering the controller when the external condition became resolvable.
The roadmap was left stranded in a wait while executable work remained.

Observed on PR #23: the round-5 review result was published as a clean issue
comment at `2026-08-23T14:53:23Z` for exact HEAD
`6047a8360156225ede01eb303c398257dca59b16`, while the run had already ended in
`WAIT_FOR_CODEX`. The condition was resolvable; nothing re-entered.

Two mechanisms contributed:

1. Nothing in the controller marked a `WAIT_*` transition as non-terminal, so a
   wait was indistinguishable from a legitimate stop.
2. `reconcile()` only looked for a PR on `feat|fix/TASK-*` branches, so on the
   governance branch it reported `pr: null` and could not observe its own CI or
   review state at all.

## Invariant

A `WAIT_*` condition is an external timing fact, never an outcome. It must never
become a normal controller exit while executable roadmap work remains. On
reaching one the controller must do exactly one of:

1. keep polling until the condition resolves;
2. persist a resumable wait state and deterministically re-enter on resume;
3. emit `BLOCKED_EXTERNAL` with exact evidence when an external hard blocker is
   proven.

Only `ROADMAP_COMPLETE`, `NO_ELIGIBLE_TASK`, `BLOCKED_EXTERNAL`,
`OWNER_DECISION` and `HUMAN_REQUIRED` may end an autonomous run. `SPEC_REQUIRED`
means write and validate the spec, not stop.

## Change

`TERMINAL_TRANSITIONS` and `WAIT_TRANSITIONS` make terminality explicit, and
every decision from `classifyLoopDecision()` now carries `terminal`.
`evaluateWaitEscalation()` converts an exhausted poll budget into
`BLOCKED_EXTERNAL` carrying the wait state, task, PR, target head, start time,
last poll and last error. `describeReentry()` reports `must_reenter` for every
non-terminal decision and, when a wait has no persisted runtime state, the exact
command that persists one so an interrupted session resumes the same wait.
`reconcile()` surfaces this as a `reentry` block.

PR discovery no longer depends on branch naming: any branch other than the
default is checked for its own PR.

## Second finding — API_CONNECTION_LOSS_NO_REENTRY

The API connection dropped immediately after PR #24 was created. No wait had
been persisted yet, nothing re-entered the controller, and a manual owner
message was required to resume. Branch CI `32647772120` was already SUCCESS for
exact HEAD `7a6dadb` and no review had been requested.

An operational interruption - session limit, context exhaustion, reviewer
disconnect, API or network failure, terminal or IDE closure, shutdown, crash -
is never a project blocker. The recovery path is always
`INTERRUPTION -> RECOVER STATE -> RECONCILE -> RESUME FIRST UNPROVEN STEP`.

The interruption landed in the gap between creating the external dependency and
persisting the wait for it, so no resumable local state existed. Recovery
therefore must not depend on `.rick/tmp` surviving: that directory is a
convenience cache, never the source of truth.

`reconstructWaitFromFacts()` derives the wait from the open PR and the
transition the controller derived from repository facts. `describeReentry()`
prefers a persisted runtime wait and falls back to reconstruction, and reports
`trigger_required` together with the `executor_bridge` that owes the wake-up, so
a resumed session can see it was owed one.

Proven in live recovery: after reconnect, `reconcile()` alone recovered PR #24,
CI `32647772120` SUCCESS, `review: null`, the `PR_POINTER_STALE` drift and
resolver `TASK-12`, with zero local runtime state.

## Review round 1 findings

Three findings against the first head, all confirmed and fixed.

**Stale checkpoint applied to a fresh wait (P1).** `.rick/tmp/loop-runtime.json`
survives transitions that never clear it, so a checkpoint could belong to an
earlier wait. An exhausted `WAIT_FOR_CODEX` for one task would make a new
`WAIT_FOR_CI` for another report `BLOCKED_EXTERNAL`, carrying the wrong PR and
head as its evidence. `waitMatchesDecision()` now requires the checkpoint to be
about the same transition, task, PR and target head; a mismatch is ignored and
reported as `stale_wait_ignored`.

**Contradictory escalation payload (P2).** An exhausted wait left `decision`
non-terminal while the nested `reentry` block said terminal, so two drivers
reading the same output could reach opposite conclusions.
`applyWaitEscalation()` promotes the escalation to a single authoritative
`BLOCKED_EXTERNAL` decision carrying its evidence, and `reconcile()` applies it
before building `reentry`.

**Governance PR assigned to the next roadmap task (P1).** On a branch that names
no task, branch-agnostic discovery found the governance PR, but
`resolveEffectiveTask()` fell back to the roadmap task and the spec gate fired
before any PR gate, so an unresolved governance PR was reported as
`SPEC_REQUIRED` for TASK-12. Reproduced live on this PR. A PR whose branch names
no task is now governance work: its gates are evaluated on its own terms, the
roadmap spec requirement does not apply to it, and every PR decision carries
`pr_number` and `pr_context`.

## Validation

`node scripts/rick-loop-controller-check.mjs` asserts that no `WAIT_*`
transition is terminal, that `SPEC_REQUIRED`, `READY_TO_MERGE`,
`RECOVERABLE_FAILURE`, `POST_MERGE_VALIDATION` and `STATE_DRIFT_DETECTED` are
non-terminal, that a fresh wait continues and an exhausted one escalates with
evidence, and that an unpersisted wait reports how to persist itself. The
existing exact-head CI, independent-review, fail-closed, architecture-signal and
Definition-of-Done rules are unchanged.
