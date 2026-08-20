import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DISPATCH_ACTIONS,
  buildExecutorDispatch,
  dispatchIdempotencyKey,
  executorCommandForDispatch,
  isDispatchableTransition,
  loadDispatchState,
  saveDispatchState,
} from "./rick-loop-executor-dispatch.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function snapshot(transition, overrides = {}) {
  return {
    repository: "devricardo90/RecompraCRM",
    state_summary: {
      mode: "CONTROLLED_AUTONOMOUS",
      current_task: "TASK-13",
      resolved_task: "TASK-13",
      ...overrides.state_summary,
    },
    git: {
      branch: "main",
      head: "2995589c88ea7ab46781b59ba273b440eb2eebdd",
      ...overrides.git,
    },
    pr: overrides.pr ?? null,
    task_spec: {
      path: "docs/specs/TASK-13.md",
      present: transition !== "SPEC_REQUIRED",
      ...overrides.task_spec,
    },
    decision: {
      transition,
      task: "TASK-13",
      reason: `${transition} fixture`,
      ...overrides.decision,
    },
  };
}

try {
  assert(isDispatchableTransition("SPEC_REQUIRED"), "SPEC_REQUIRED must dispatch");
  assert(isDispatchableTransition("TASK_ADVANCE"), "TASK_ADVANCE must dispatch");
  assert(isDispatchableTransition("STATE_DRIFT_DETECTED"), "deterministic drift must dispatch reconciliation");
  assert(!isDispatchableTransition("WAIT_FOR_CI"), "WAIT_FOR_CI must not wake an executor");
  assert(!isDispatchableTransition("WAIT_FOR_CODEX"), "WAIT_FOR_CODEX must not wake an executor");
  assert(!isDispatchableTransition("HUMAN_REQUIRED"), "HUMAN_REQUIRED must never auto-dispatch");

  const spec = buildExecutorDispatch(snapshot("SPEC_REQUIRED"), { now: new Date("2026-08-20T15:00:00Z") });
  assert(spec.dispatchable === true, "SPEC_REQUIRED should build a dispatch");
  assert(spec.action === DISPATCH_ACTIONS.SPEC_REQUIRED, "SPEC_REQUIRED action mismatch");
  assert(spec.task === "TASK-13", "dispatch task mismatch");
  assert(spec.prompt.includes("Task: TASK-13"), "prompt must name resolved task");
  assert(spec.prompt.includes("Do not write product code until the spec CI and exact-HEAD independent review are clean"), "spec-first gate missing from prompt");
  assert(spec.prompt.includes("do not ask Ricardo"), "autonomous no-prompt contract missing");
  assert(spec.prompt.includes("Never invoke a second executor recursively"), "recursion guard missing");

  const specLater = buildExecutorDispatch(snapshot("SPEC_REQUIRED"), { now: new Date("2026-08-20T15:10:00Z") });
  assert(spec.idempotency_key === specLater.idempotency_key, "timestamps must not change dispatch identity");
  assert(dispatchIdempotencyKey(snapshot("SPEC_REQUIRED")) === spec.idempotency_key, "idempotency helper mismatch");

  const advanced = buildExecutorDispatch(snapshot("TASK_ADVANCE", {
    state_summary: { current_task: "TASK-12", resolved_task: "TASK-13" },
    decision: { task: "TASK-13", reason: "TASK-12 blocked by ARCH-01" },
  }));
  assert(advanced.action === "ADVANCE_TASK", "TASK_ADVANCE must persist deterministic selection");
  assert(advanced.prompt.includes("task-scoped blocker blocks only that task"), "task-scoped blocker contract missing");

  const drift = buildExecutorDispatch(snapshot("STATE_DRIFT_DETECTED", {
    decision: { task: null, reason: "STATE/HANDOFF mismatch" },
  }));
  assert(drift.dispatchable === true && drift.action === "RECONCILE_STATE", "state drift must dispatch reconciliation");

  const wait = buildExecutorDispatch(snapshot("WAIT_FOR_CI"));
  assert(wait.dispatchable === false, "wait states must not generate executor work");

  const missingTask = buildExecutorDispatch(snapshot("SPEC_REQUIRED", {
    state_summary: { current_task: null, resolved_task: null },
    decision: { task: null },
  }));
  assert(missingTask.dispatchable === false, "task-requiring dispatch must fail closed without a task");

  const claude = executorCommandForDispatch(spec, {
    RICK_LOOP_EXECUTOR_KIND: "claude-code",
    RICK_LOOP_EXECUTOR_BIN: "claude",
  });
  assert(claude.configured === true && claude.bin === "claude", "Claude Code bridge should configure explicitly");
  assert(claude.args[0] === "-p" && claude.args[1] === spec.prompt, "Claude Code bridge must pass generated prompt without shell interpolation");

  const generic = executorCommandForDispatch(spec, {
    RICK_LOOP_EXECUTOR_KIND: "generic",
    RICK_LOOP_EXECUTOR_BIN: "executor-wrapper",
  }, ".rick/tmp/executor-dispatch.json");
  assert(generic.configured === true && generic.args.length === 1, "generic bridge should receive only the dispatch file path");

  const unconfigured = executorCommandForDispatch(spec, {});
  assert(unconfigured.configured === false, "missing bridge configuration must fail closed");

  const dir = mkdtempSync(join(tmpdir(), "rick-loop-dispatch-"));
  const statePath = join(dir, "dispatch.json");
  saveDispatchState(spec, statePath);
  assert(loadDispatchState(statePath)?.idempotency_key === spec.idempotency_key, "dispatch state round-trip failed");
  saveDispatchState(null, statePath);
  assert(loadDispatchState(statePath) === null, "dispatch clear failed");
  rmSync(dir, { recursive: true, force: true });

  console.log("Rick Loop executor dispatch checks passed.");
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
}
