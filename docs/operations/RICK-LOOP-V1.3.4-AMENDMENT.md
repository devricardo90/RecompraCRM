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

## Review round 2 findings

Four findings, two of them defects in the round 1 fixes themselves.

**Checkpoint identity was optional (P1).** `waitMatchesDecision()` skipped a
comparison whenever the checkpoint's field was absent, and the CLI makes
`prNumber` and `targetHead` optional. A checkpoint identifying nothing therefore
matched any PR and head. Every identity component the current wait supplies must
now be present and equal in the checkpoint.

**describeReentry still escalated on its own (P2).** It re-derived terminality
from the poll budget, so an unpromoted `WAIT_*` decision could be reported as
terminal while the decision said otherwise - the very contradiction round 1
claimed to remove. Terminality is now read from the decision alone.
`describeReentry()` reports `poll_budget` and `escalation_required` for
observability, and `applyWaitEscalation()` is genuinely the only thing that ends
a wait.

**SPEC_REQUIRED lost its PR context (P2).** The early return ran before the PR
wrapper existed, so it violated the new invariant that every PR decision names
its PR. It is now wrapped like the gate decisions.

**Governance context depended on PR state (P1).** `findPrForBranch()` searches
every state, so after a governance PR merged, `governancePr` became false and
classification returned `SPEC_REQUIRED` before reaching post-merge validation.
Governance context now comes from the branch naming no task, regardless of PR
state, and the merged check runs before the spec gate.

## Review round 3 findings

Two findings, both defects in the round 2 fixes.

**describeReentry overruled the decision (P2).** It classified the transition
again instead of reading `decision.terminal`, so an explicitly terminal
`WAIT_FOR_CI` reported non-terminal and an explicitly non-terminal
`ROADMAP_COMPLETE` reported terminal. The decision is now the authority: its own
`terminal` field wins whenever it has one.

**Early exits still lacked PR context (P2).** `STATE_DRIFT_DETECTED`,
`HUMAN_REQUIRED`, `ROADMAP_COMPLETE` and `NO_ELIGIBLE_TASK` returned before the PR
wrapper existed. The PR context is now established before the first exit, so
every decision taken while a PR is active names it, and a decision taken with no
active PR still invents none.

## Architecture complexity signal

While fixing round 3, the signal itself was found not to fire: nine recorded
governance findings across seven review rounds reported only four rounds,
because `review_round` restarts at 1 on each PR and a bare round number collides
across PRs. Round identity is now the PR plus the number.

With that corrected the signal fires for LOOP-GOVERNANCE: it reached the
threshold of five at the round-2 entry on PR #24 and keeps rising as rounds are
recorded. It is recorded as `ARCH-03` and is non-blocking: it does not
reopen this PR or any completed task. The defect classes cluster in one place -
what counts as a published clean review result, and what counts as a live wait -
which is the contract worth consolidating rather than the individual fixes.

## Review round 4 findings

Two findings, both new surface exposed by the earlier fixes rather than repeats.

**Promotion dropped PR identity (P2).** `applyWaitEscalation()` built a fresh
decision object, so `BLOCKED_EXTERNAL` - the one exit that ends a run - was the
only active-PR decision that could not be tied to its PR at the top level. The
promoted decision now carries whatever PR identity the classified decision had,
and invents none when it had none.

**The signal was scored under the wrong task (P2).** `reconcile()` always scored
the register under `effectiveTask`, so on a governance PR it scored under
TASK-12 and reported zero rounds while the recorded LOOP-GOVERNANCE signal was
live. `architectureSignalScope()` now derives the scope from the PR context.
Verified live: the controller reports `ARCHITECTURE_COMPLEXITY_SIGNAL` for
LOOP-GOVERNANCE. The live count is always derived from the register; as of HEAD
`8427dbe` it is seven distinct rounds - PR #23 rounds 2 to 4 and PR #24 rounds 1
to 4 - against a threshold of five.

## Review round 6 findings

One finding, no code defects.

**The register was rewritten in place (P2).** Round 5 corrected the round-4
entry's stale six-round count by editing the published entry. The register is
append-only, and it already records the identical remedy for the analogous
TASK-07 case at line 14, where the same violation was flagged on review. The
round-4 entry is restored byte-for-byte, including its stale claim, and the
round-6 entry carries the correction and supersedes the round-5 assertion that
editing in place was right.

Recorded as `LESSON-RCRM-0020`, and the append-only contract is now written into
the protocol rather than living only as precedent inside the log it governs.

## Validation

`node scripts/rick-loop-controller-check.mjs` asserts that no `WAIT_*`
transition is terminal, that `SPEC_REQUIRED`, `READY_TO_MERGE`,
`RECOVERABLE_FAILURE`, `POST_MERGE_VALIDATION` and `STATE_DRIFT_DETECTED` are
non-terminal, that a fresh wait continues and an exhausted one escalates with
evidence, and that an unpersisted wait reports how to persist itself. The
existing exact-head CI, independent-review, fail-closed, architecture-signal and
Definition-of-Done rules are unchanged.
