# Rick Loop v1.3 — LOOP-UPGRADE-02

Status: FROZEN_AFTER_MERGE_UNTIL_TASK_17
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
