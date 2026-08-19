# Rick Loop v1.3 — LOOP-UPGRADE-02

Status: FROZEN_AFTER_MERGE_UNTIL_TASK_17 (amended once, v1.3.1)
Project pilot: Recompra CRM
Purpose: harden resume/reconciliation before continuing TASK-09 through TASK-17.

## Invariants

1. Repository facts beat stale prose. Git branch/HEAD, active PR, CI and review are reconciled before any write.
2. A contradiction between those facts and STATE/HANDOFF becomes `STATE_DRIFT_DETECTED`; the loop must reconcile pointers before implementation, fix, merge or task advance.
3. Every numbered task requires `docs/specs/TASK-NN.md` before implementation or recovery writes.
4. Side-effecting work uses a lightweight pre-write checkpoint in `.rick/tmp/prewrite.json`. One active intent is allowed at a time; repeating the same intent reuses its deterministic idempotency key.
5. Waits on CI/review/GitHub never consume stagnation attempts. Three consecutive attempts without real progress produce `HUMAN_REQUIRED`. Any demonstrated progress resets the counter.
6. Runtime and pre-write files are written atomically (temp file + rename) so restart cannot silently erase an in-flight state.
7. Version v1.3 is frozen through TASK-17. Only a defect that blocks or corrupts execution may change the loop before the final pilot audit.
8. Amendment v1.3.1 (see below) was authorized by the owner after TASK-09 closed. Its review-gate item also qualifies under invariant 7 on its own: the gate was accepting reviews anchored to older commits.

## Canonical task states

`READY → SPEC_REQUIRED → IMPLEMENTING → VALIDATING → WAIT_CI → WAIT_REVIEW → REVIEW_LANDED → RECOVERING/READY_TO_MERGE → POST_MERGE_VALIDATION → COMPLETED`

The controller may derive a state from facts even if the persisted status is less precise. It must not invent a completed task from prose alone.

## Resume algorithm

On restart, `node scripts/rick-loop-controller.mjs` must:

1. read STATE and ROADMAP;
2. inspect local Git facts;
3. locate an active PR for `current_task` even when the checkout is on `main`;
4. inspect the PR HEAD, CI and latest review;
5. verify the task spec exists;
6. compare those facts with persisted pointers;
7. return either a safe transition or `STATE_DRIFT_DETECTED`.

This means an existing TASK-09 PR can never be interpreted as `START_TASK_09` after a restart.

## Pre-write

Examples:

```bash
node scripts/rick-loop-controller.mjs prewrite start TASK-09 fix-review-findings VALIDATING <head-sha>
node scripts/rick-loop-controller.mjs prewrite status
node scripts/rick-loop-controller.mjs prewrite complete VALIDATING
```

The checkpoint stores only task, intended action, expected state, target HEAD, timestamp and idempotency key. It deliberately does not store screenshots or large context blobs.

## Stagnation

```bash
node scripts/rick-loop-controller.mjs stagnation stagnant 2 3
node scripts/rick-loop-controller.mjs stagnation progress 2 3
```

External waiting is tracked by the existing bounded backoff engine and does not increment stagnation.

## Pilot comparison

The final audit will compare TASK-01..08 (pre-v1.3) with TASK-09..17 (v1.3) on interruptions, human interventions, review rounds, recoveries, state drift and restart success. Only after TASK-17 should approved mechanisms be promoted into the RCC Deterministic Orchestrator Kernel.


---

# Amendment v1.3.1 — evidence from TASK-09

Authorized by the owner after TASK-09 was merged and reconciled. TASK-09 needed
nine review rounds carrying eleven confirmed defects; every rule below is a
generalization of something that actually went wrong or was actually caught,
not a speculative guardrail. The rules are additive and do not change how a task
executes.

## A. ARCHITECTURE_COMPLEXITY_SIGNAL

When a task reaches **5 or more review rounds** containing distinct, confirmed,
substantive defects, the controller emits `ARCHITECTURE_COMPLEXITY_SIGNAL`.

- non-blocking: the task keeps converging normally;
- never restarts the task and never authorizes scope creep;
- records the defect classes and the affected subsystem;
- creates or proposes a follow-up architecture item.

Counting rules, deliberately strict:

- count **review rounds**, not comments — one round reporting four findings is
  one round;
- producing a new commit **must not** reset the counter;
- only rounds carrying a confirmed finding count; a round that reports nothing
  neither increments nor resets.

Implemented as `evaluateArchitectureComplexitySignal()` in
`scripts/rick-loop-controller.mjs`, reading `LOOP-REGISTER.jsonl`, and surfaced
as `architecture_signal` in the reconcile output.

Canonical example: TASK-09 → roadmap item `ARCH-01` (persisted vs computed
repurchase forecast), to be decided before TASK-12 couples a dashboard to the
current design.

## B. Exact-HEAD review invariant

A review satisfies the review gate **only** when it is anchored to the current
exact HEAD.

- an approval, review, or reaction for an older SHA is **evidence only** and
  must not satisfy the gate for a newer HEAD;
- any code change invalidates the previous review gate automatically;
- silence is never approval;
- the reviewer's clean-comment path counts, but only when the comment names the
  exact current HEAD. The reviewer abbreviates that SHA, so the comparison is a
  prefix match against the full HEAD, never a substring search of the body.

This was a live defect, not a hypothetical: `prReview()` returned the PR's own
head as `headRefOid` and then compared it to `pr.headRefOid`, so the condition
was always false and *any* review on *any* older commit passed the gate. Fixed
by `selectAnchoredReview()` / `selectAnchoredCleanComment()`, both covered by
tests including the stale-SHA rejection.

Operational corollary, learned the hard way: when polling GitHub for a bot's
result, match the bot login exactly — it carries a `[bot]` suffix. A filter
missing that suffix reports "no result" while the clean result is already there.

## C. Reviewer suggestions are hypotheses, not commands

No reviewer-proposed implementation may be accepted solely because the reviewer
proposed it. For actionable correctness or concurrency findings:

1. reproduce the defect when feasible;
2. implement the candidate fix;
3. prove the defect no longer occurs;
4. run the regression gates.

If the proposed remedy fails that evidence, reject it and implement the
evidence-supported alternative, recording why.

Separate the two halves of a review: the **diagnosis** and the **remedy**. A
correct diagnosis does not make the attached remedy correct.

Canonical example: TASK-09 round 5. The diagnosis (a stale `REPEATABLE READ`
snapshot persisting a wrong forecast) was correct and reproduced. The proposed
remedy, `FOR KEY SHARE`, was implemented and disproven against a real database —
the input is changed by a non-key `UPDATE`, which KEY SHARE does not conflict
with, so no serialization failure fires and the stale value is still served. The
shipped fix was `FOR NO KEY UPDATE` with a fixed lock order.

## D. Pre-fix / post-fix evidence

For P0/P1 and for any concurrency or data-integrity defect, prefer a regression
harness proving:

> defect exists before the fix → defect absent after the fix

Run each case at the migration or code depth where the defect actually existed
when practical, rather than only on the final state. TASK-09's harness builds
the database at seven different migration depths for exactly this reason, and it
is what caught the failed `FOR KEY SHARE` remedy on its first run.

Corollary: assert the specific failure, not merely "it failed". Client libraries
collapse distinct SQLSTATEs into one generic error, so issue the probe as raw
SQL when the difference matters — TASK-09 had to distinguish `40001` from
`40P01`.

## E. External gate continuation

While waiting on CI, a reviewer, or any external system for an exact HEAD:

- re-check the external state periodically;
- keep the SHA anchor for the whole wait;
- continue automatically when a clean result attributable to that exact HEAD
  arrives;
- never interpret silence, or an unrelated reaction, as approval — a 👀 is
  acknowledgement, only 👍 or a clean verdict closes the gate;
- never move the HEAD merely to update state documentation, because that
  invalidates the gate under rule B;
- re-requesting a review on the same SHA is allowed and does not move the HEAD;
- stop only for a genuine owner-required gate, an unrecoverable external
  failure, a configured safety limit, or an environment that cannot continue.

Waiting never consumes stagnation attempts (invariant 5).

## F. Failed-attempt learning

When the agent's own candidate fix fails a regression gate, preserve the
learning without shipping the implementation. Record what was tried, what broke,
and why the shipped alternative differs.

Canonical example: TASK-09's first attempt at the lock cycles was a single
global advisory mutex. It removed the deadlocks and hung the TASK-07 concurrency
case, which requires two transactions to each write before either commits. It
was never pushed; the shipped design is a shared/exclusive split.

## Report vocabulary

Final reports must keep these classes distinct rather than merging them into one
list of "issues":

| Class | Meaning |
| --- | --- |
| `REVIEW_FINDING` | a defect an independent review found and that was fixed |
| `AGENT_FAILED_ATTEMPT` | a fix the agent tried that failed its own gates and was not shipped |
| `ACCEPTED_RESIDUAL` | a known limitation deliberately kept, with the reason it was not closed |
| `ARCHITECTURE_SIGNAL` | a non-blocking signal that the design, not the change, is the problem |
