# Rick Loop v1.3.3 — Executor Dispatch Amendment

Status: PROPOSED_EXECUTABLE_AMENDMENT
Parent: RICK_LOOP_V1_3_2
Pilot: RecompraCRM / MVP-01

## Why this amendment exists

The v1.3.2 resolver correctly proved that TASK-12 was task-scoped blocked by
ARCH-01 and that TASK-13 was the next eligible task. The loop still required a
human to copy a prompt into the local coding agent before execution resumed.
That is a real autonomy defect: deterministic selection without executor wake-up
is not continuous controlled-autonomous execution.

The freeze exception applies because this defect blocks execution continuity.
This amendment does not change product scope, task eligibility, review gates or
safety policy. It adds the missing dispatch layer between the deterministic
controller and an external executor.

## Architecture

The runtime path becomes:

```text
ROADMAP / STATE / HANDOFF / Git / GitHub
              |
              v
    rick-loop-controller.mjs
              |
              | controller decision
              v
rick-loop-executor-dispatch.mjs
              |
              | EXECUTOR_DISPATCH
              v
       configured bridge
              |
              v
         coding agent
```

The controller remains the source of deterministic state transitions. The
dispatcher never decides which task is eligible and never overrides a controller
stop condition.

## Dispatchable controller transitions

The dispatcher may wake an executor only for locally actionable transitions:

| Controller transition | Executor action |
| --- | --- |
| `STATE_DRIFT_DETECTED` | `RECONCILE_STATE` |
| `TASK_ADVANCE` | `ADVANCE_TASK` |
| `SPEC_REQUIRED` | `PREPARE_SPEC` |
| `PASS` | `CONTINUE_TASK` |
| `REVIEW_LANDED` | `PROCESS_REVIEW` |
| `RECOVERABLE_FAILURE` | `RECOVER_FAILURE` |
| `POST_MERGE_VALIDATION` | `VALIDATE_POST_MERGE` |

These states do **not** auto-dispatch: `WAIT_FOR_CI`, `WAIT_FOR_CODEX`,
`EXTERNAL_RETRYABLE`, `NO_ELIGIBLE_TASK`, `HUMAN_REQUIRED`, and
`ROADMAP_COMPLETE`. External waits remain the responsibility of the wake-up /
polling layer; owner-required and terminal states remain stopped.

## Deterministic dispatch payload

Each dispatch is written atomically to:

```text
.rick/tmp/executor-dispatch.json
```

The payload contains:

- loop version;
- controller transition and reason;
- resolved task;
- repository branch and exact HEAD;
- PR number and exact PR HEAD when present;
- task spec path;
- deterministic idempotency key;
- generated executor prompt;
- STATE, HANDOFF and ROADMAP paths.

The idempotency key excludes timestamps. Re-emitting the same controller facts
therefore preserves the same dispatch identity. A changed HEAD, PR HEAD, task,
transition or spec path produces a new identity.

The generated prompt is intentionally defensive:

1. repository facts beat the payload if facts moved after dispatch;
2. the executor reruns `npm run loop:status` before its first write;
3. task-scoped blockers never become roadmap-global blockers;
4. one completed task does not stop the roadmap;
5. all existing pre-write, CI, exact-HEAD review, Playwright and post-merge gates
   remain mandatory;
6. the executor must not recursively spawn another executor;
7. after each locally actionable state change the same executor session reruns
   the controller and continues until a formal wait/stop state appears.

## Bridge contract

`npm run loop:dispatch` emits the current deterministic payload and, when a
bridge is configured, invokes the external executor without a shell.

Supported bridge kinds:

### Claude Code

Environment:

```text
RICK_LOOP_EXECUTOR_KIND=claude-code
RICK_LOOP_EXECUTOR_BIN=claude
```

The dispatcher invokes the configured binary with:

```text
claude -p <generated-prompt>
```

The call uses `spawnSync(..., shell: false)`. The generated prompt is passed as
one argument, not interpolated into a shell command.

### Generic bridge

Environment:

```text
RICK_LOOP_EXECUTOR_KIND=generic
RICK_LOOP_EXECUTOR_BIN=<wrapper executable>
```

The wrapper receives exactly one argument: the absolute path to
`.rick/tmp/executor-dispatch.json`. This is the extension point for Cursor,
other agents, a VM runner, or a future RCC executor adapter.

If no bridge is configured for a dispatchable transition, the command fails
closed with `EXECUTOR_BRIDGE_REQUIRED`. It never pretends that an executor was
woken.

## CLI

```text
npm run loop:status
npm run loop:dispatch:emit
npm run loop:dispatch:status
npm run loop:dispatch
```

`loop:dispatch:emit` is useful for inspecting the generated payload without
starting an executor. `loop:dispatch` performs the actual bridge invocation.

## One-time local wiring for the current Windows pilot

In the terminal session that owns the scheduled wake-up:

```powershell
$env:RICK_LOOP_EXECUTOR_KIND = "claude-code"
$env:RICK_LOOP_EXECUTOR_BIN = "claude"
npm run loop:dispatch
```

To persist the two variables for future terminals:

```powershell
setx RICK_LOOP_EXECUTOR_KIND claude-code
setx RICK_LOOP_EXECUTOR_BIN claude
```

A newly opened terminal is required after `setx`. The existing scheduled wake-up
must execute `npm run loop:dispatch`, not only `npm run loop:status`. That is the
one-time machine integration required for true automatic wake-up on the local
computer.

## Safety and failure semantics

- No credential is written into the dispatch payload.
- The dispatcher never uses `shell: true`.
- Unsupported executor kinds fail closed.
- Missing executor configuration fails closed.
- Executor non-zero exit is recorded as `FAILED` with the exit code.
- Successful process exit is recorded as `EXECUTOR_EXITED_SUCCESS`; it does not
  imply that the task itself is complete. Repository/controller facts decide
  that on the next reconciliation.
- Wait and owner-required states never invoke an executor.

## Regression proof required

The executable amendment is not accepted unless tests prove at least:

1. `SPEC_REQUIRED` produces a TASK-13 dispatch with the spec-first gate;
2. `TASK_ADVANCE` produces an advance/reconcile dispatch rather than an owner
   prompt;
3. deterministic STATE drift produces `RECONCILE_STATE`;
4. `WAIT_FOR_CI`, `WAIT_FOR_CODEX`, and `HUMAN_REQUIRED` do not dispatch;
5. dispatch identity is stable across timestamps;
6. a task-requiring transition fails closed if no task is resolved;
7. Claude Code invocation is built as argument-array execution, not shell text;
8. missing bridge configuration fails closed;
9. dispatch-state persistence is atomic and clearable.

## Pilot acceptance criterion

After this amendment is merged and the local bridge is configured, a scheduled
wake-up must be able to:

```text
controller decides locally actionable work
→ dispatcher emits EXECUTOR_DISPATCH
→ Claude Code starts without a pasted human prompt
→ executor continues until an external wait/formal stop
→ wake-up later resumes through the same deterministic path
```

This closes the specific gap observed between deterministic TASK-13 selection
and actual executor continuation.
