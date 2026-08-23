# Rick Loop v1.3.4 amendment — WAIT_* states are non-terminal

```yaml
amendment: RICK_LOOP_V1_3_4
status: PROPOSED_ON_PR
finding: TRANSIENT_WAIT_NO_REENTRY
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

## Validation

`node scripts/rick-loop-controller-check.mjs` asserts that no `WAIT_*`
transition is terminal, that `SPEC_REQUIRED`, `READY_TO_MERGE`,
`RECOVERABLE_FAILURE`, `POST_MERGE_VALIDATION` and `STATE_DRIFT_DETECTED` are
non-terminal, that a fresh wait continues and an exhausted one escalates with
evidence, and that an unpersisted wait reports how to persist itself. The
existing exact-head CI, independent-review, fail-closed, architecture-signal and
Definition-of-Done rules are unchanged.
