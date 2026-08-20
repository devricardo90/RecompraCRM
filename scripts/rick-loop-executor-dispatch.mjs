import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();

export const DISPATCH_STATE_PATH = ".rick/tmp/executor-dispatch.json";
export const DISPATCH_LOOP_VERSION = "RICK_LOOP_V1_3_3";

export const DISPATCH_ACTIONS = Object.freeze({
  STATE_DRIFT_DETECTED: "RECONCILE_STATE",
  TASK_ADVANCE: "ADVANCE_TASK",
  SPEC_REQUIRED: "PREPARE_SPEC",
  PASS: "CONTINUE_TASK",
  REVIEW_LANDED: "PROCESS_REVIEW",
  RECOVERABLE_FAILURE: "RECOVER_FAILURE",
  POST_MERGE_VALIDATION: "VALIDATE_POST_MERGE",
});

const ACTION_INSTRUCTIONS = Object.freeze({
  RECONCILE_STATE: "Reconcile STATE.md, HANDOFF.md and ROADMAP.md against repository facts before any product write. Clear deterministic drift, rerun the controller, then continue from the resulting transition.",
  ADVANCE_TASK: "Persist the resolver-selected task in STATE.md and HANDOFF.md, preserving task-scoped blockers on other tasks. Rerun the controller and continue without asking for intermediate approval.",
  PREPARE_SPEC: "Derive and review the required task spec from the canonical product source, PROJECT-SDD and ROADMAP before implementation. Do not write product code until the spec CI and exact-HEAD independent review are clean.",
  CONTINUE_TASK: "Continue implementation from the reviewed task spec. Run the required deterministic gates, targeted ephemeral Playwright when UI changes, exact-HEAD independent review, and correction loops until the task can merge or a formal stop condition occurs.",
  PROCESS_REVIEW: "Inspect exact-HEAD review findings as hypotheses. Fix confirmed findings with regression evidence, rerun gates and request a new exact-HEAD review. If the review is clean, merge through the normal gate and continue.",
  RECOVER_FAILURE: "Diagnose the recoverable failure, prove the defect where practical, correct it without scope expansion, rerun deterministic gates and continue the same task.",
  VALIDATE_POST_MERGE: "Validate the merged main HEAD, reconcile operational documents, invoke the deterministic next-task resolver and continue to the next eligible task instead of stopping at task completion.",
});

function normalize(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

export function isDispatchableTransition(transition) {
  return Boolean(transition && DISPATCH_ACTIONS[transition]);
}

export function dispatchTask(snapshot) {
  return normalize(snapshot?.decision?.task)
    ?? normalize(snapshot?.state_summary?.resolved_task)
    ?? normalize(snapshot?.state_summary?.current_task);
}

export function dispatchIdempotencyKey(snapshot) {
  const transition = normalize(snapshot?.decision?.transition) ?? "UNKNOWN";
  const action = DISPATCH_ACTIONS[transition] ?? "NONE";
  const task = dispatchTask(snapshot) ?? "none";
  const sourceHead = normalize(snapshot?.git?.head) ?? "none";
  const prNumber = normalize(snapshot?.pr?.number) ?? "none";
  const prHead = normalize(snapshot?.pr?.headRefOid) ?? "none";
  const taskSpec = normalize(snapshot?.task_spec?.path) ?? "none";
  return createHash("sha256")
    .update([transition, action, task, sourceHead, prNumber, prHead, taskSpec].join("|"))
    .digest("hex")
    .slice(0, 20);
}

export function buildDispatchPrompt(snapshot, { task, action, dispatchId }) {
  const mode = normalize(snapshot?.state_summary?.mode) ?? "CONTROLLED_AUTONOMOUS";
  const repository = normalize(snapshot?.repository) ?? "unknown";
  const branch = normalize(snapshot?.git?.branch) ?? "unknown";
  const head = normalize(snapshot?.git?.head) ?? "unknown";
  const prNumber = normalize(snapshot?.pr?.number) ?? "none";
  const prHead = normalize(snapshot?.pr?.headRefOid) ?? "none";
  const taskSpec = normalize(snapshot?.task_spec?.path) ?? "none";
  const transition = normalize(snapshot?.decision?.transition) ?? "UNKNOWN";
  const reason = normalize(snapshot?.decision?.reason) ?? "none";
  const instruction = ACTION_INSTRUCTIONS[action] ?? "Reconcile repository facts and continue according to the Rick Loop.";

  return `RICK LOOP EXECUTOR DISPATCH\n\nDispatch ID: ${dispatchId}\nLoop version: ${DISPATCH_LOOP_VERSION}\nMode: ${mode}\nRepository: ${repository}\nController transition: ${transition}\nController reason: ${reason}\nTask: ${task ?? "none"}\nRepository branch at dispatch: ${branch}\nRepository HEAD at dispatch: ${head}\nPR: ${prNumber}\nPR HEAD: ${prHead}\nTask spec: ${taskSpec}\n\nRequired action:\n${instruction}\n\nExecution contract:\n1. Repository facts are authoritative. Re-read git/GitHub facts and run \`npm run loop:status\` before the first write. If facts moved since this dispatch, follow the newer facts and discard stale assumptions from this payload.\n2. Preserve CONTROLLED_AUTONOMOUS behavior: do not ask Ricardo to \"say the word\" and do not stop merely because one task completed.\n3. A task-scoped blocker blocks only that task. If another pending task is eligible, use the deterministic resolver and continue.\n4. Do not bypass pre-write, CI, exact-HEAD review, Playwright, post-merge validation, STATE/HANDOFF reconciliation, or formal safety gates.\n5. While work is locally actionable, continue within this executor session by rerunning the controller after each state-changing step. Exit only for a controller wait state, NO_ELIGIBLE_TASK, HUMAN_REQUIRED, ROADMAP_COMPLETE, an unrecoverable external failure, or a configured safety limit.\n6. Never invoke a second executor recursively from inside this executor session. The external wake-up bridge is responsible for the next wake after a wait state.\n7. Record any new orchestration defect from this pilot for the final Rick Loop / RCC deterministic orchestrator analysis.\n`;
}

export function buildExecutorDispatch(snapshot, { now = new Date() } = {}) {
  const transition = normalize(snapshot?.decision?.transition);
  if (!isDispatchableTransition(transition)) {
    return {
      dispatchable: false,
      transition,
      reason: normalize(snapshot?.decision?.reason) ?? "controller transition is not locally dispatchable",
    };
  }

  const action = DISPATCH_ACTIONS[transition];
  const task = dispatchTask(snapshot);
  if (["TASK_ADVANCE", "SPEC_REQUIRED", "PASS"].includes(transition) && !task) {
    return {
      dispatchable: false,
      transition,
      reason: `${transition} requires a resolved task before executor dispatch`,
    };
  }

  const idempotencyKey = dispatchIdempotencyKey(snapshot);
  const dispatch = {
    schema_version: "1.0",
    loop_version: DISPATCH_LOOP_VERSION,
    event: "EXECUTOR_DISPATCH",
    status: "PENDING",
    dispatchable: true,
    idempotency_key: idempotencyKey,
    generated_at: now.toISOString(),
    repository: normalize(snapshot?.repository),
    mode: normalize(snapshot?.state_summary?.mode),
    transition,
    action,
    task,
    source: {
      branch: normalize(snapshot?.git?.branch),
      head: normalize(snapshot?.git?.head),
      pr_number: snapshot?.pr?.number ?? null,
      pr_head: normalize(snapshot?.pr?.headRefOid),
      decision_reason: normalize(snapshot?.decision?.reason),
    },
    paths: {
      state: "docs/operations/STATE.md",
      handoff: "docs/operations/HANDOFF.md",
      roadmap: "docs/roadmap/ROADMAP.md",
      task_spec: normalize(snapshot?.task_spec?.path),
    },
  };
  dispatch.prompt = buildDispatchPrompt(snapshot, { task, action, dispatchId: idempotencyKey });
  return dispatch;
}

function saveJsonAtomic(valueOrNull, path = DISPATCH_STATE_PATH) {
  if (valueOrNull === null) {
    if (existsSync(path)) unlinkSync(path);
    return;
  }
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tempPath = join(dir, `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(tempPath, `${JSON.stringify(valueOrNull, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
}

export function loadDispatchState(path = DISPATCH_STATE_PATH) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

export function saveDispatchState(valueOrNull, path = DISPATCH_STATE_PATH) {
  saveJsonAtomic(valueOrNull, path);
}

function sh(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: "utf8", cwd: repoRoot }).trim(); } catch { return null; }
}

function repoSlug() {
  const url = sh("git", ["remote", "get-url", "origin"]);
  const match = url?.match(/github\.com[:/](.+?)(?:\.git)?$/);
  return match ? match[1] : null;
}

export function readControllerSnapshot() {
  const raw = execFileSync(process.execPath, [join(repoRoot, "scripts", "rick-loop-controller.mjs")], {
    encoding: "utf8",
    cwd: repoRoot,
  });
  const snapshot = JSON.parse(raw);
  return { ...snapshot, repository: repoSlug() };
}

export function executorCommandForDispatch(dispatch, env = process.env, dispatchPath = DISPATCH_STATE_PATH) {
  const kind = String(env.RICK_LOOP_EXECUTOR_KIND ?? "").trim().toLowerCase();
  if (!kind) return { configured: false, reason: "RICK_LOOP_EXECUTOR_KIND is not configured" };

  if (kind === "claude-code") {
    const bin = String(env.RICK_LOOP_EXECUTOR_BIN ?? "claude").trim();
    if (!bin) return { configured: false, reason: "Claude Code executor binary is empty" };
    return { configured: true, kind, bin, args: ["-p", dispatch.prompt] };
  }

  if (kind === "generic") {
    const bin = String(env.RICK_LOOP_EXECUTOR_BIN ?? "").trim();
    if (!bin) return { configured: false, reason: "generic executor requires RICK_LOOP_EXECUTOR_BIN" };
    return { configured: true, kind, bin, args: [resolve(dispatchPath)] };
  }

  return { configured: false, reason: `unsupported RICK_LOOP_EXECUTOR_KIND: ${kind}` };
}

export function invokeExecutor(dispatch, { env = process.env, dispatchPath = DISPATCH_STATE_PATH } = {}) {
  const command = executorCommandForDispatch(dispatch, env, dispatchPath);
  if (!command.configured) return { ok: false, configured: false, reason: command.reason };

  const started = {
    ...dispatch,
    status: "RUNNING",
    attempt: Number(dispatch.attempt ?? 0) + 1,
    executor_kind: command.kind,
    executor_bin: command.bin,
    started_at: new Date().toISOString(),
  };
  saveDispatchState(started, dispatchPath);

  const result = spawnSync(command.bin, command.args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    env: {
      ...env,
      RICK_LOOP_DISPATCH_ID: dispatch.idempotency_key,
      RICK_LOOP_DISPATCH_PATH: resolve(dispatchPath),
    },
  });

  if (result.error || result.status !== 0) {
    const failed = {
      ...started,
      status: "FAILED",
      finished_at: new Date().toISOString(),
      exit_code: result.status,
      error: result.error?.message ?? null,
    };
    saveDispatchState(failed, dispatchPath);
    return { ok: false, configured: true, dispatch: failed };
  }

  const completed = {
    ...started,
    status: "EXECUTOR_EXITED_SUCCESS",
    finished_at: new Date().toISOString(),
    exit_code: 0,
  };
  saveDispatchState(completed, dispatchPath);
  return { ok: true, configured: true, dispatch: completed };
}

function emitCurrentDispatch() {
  const snapshot = readControllerSnapshot();
  const proposed = buildExecutorDispatch(snapshot);
  if (!proposed.dispatchable) {
    saveDispatchState(null);
    return { ...proposed, event: "EXECUTOR_DISPATCH_SKIPPED" };
  }

  const previous = loadDispatchState();
  const sameIntent = previous?.idempotency_key === proposed.idempotency_key;
  const emitted = {
    ...proposed,
    attempt: sameIntent ? Number(previous?.attempt ?? 0) : 0,
    previous_status: sameIntent ? previous?.status ?? null : null,
    supersedes: !sameIntent && previous?.idempotency_key ? previous.idempotency_key : null,
  };
  saveDispatchState(emitted);
  return emitted;
}

function main() {
  const [, , command = "run"] = process.argv;

  if (command === "status") {
    console.log(JSON.stringify(loadDispatchState() ?? { active: false }, null, 2));
    return;
  }

  if (command === "clear") {
    saveDispatchState(null);
    console.log(JSON.stringify({ cleared: true }, null, 2));
    return;
  }

  if (command !== "emit" && command !== "run") {
    console.error("Usage: rick-loop-executor-dispatch.mjs <emit|run|status|clear>");
    process.exit(1);
  }

  const dispatch = emitCurrentDispatch();
  if (command === "emit" || !dispatch.dispatchable) {
    console.log(JSON.stringify(dispatch, null, 2));
    return;
  }

  const invocation = invokeExecutor(dispatch);
  if (!invocation.configured) {
    console.error(JSON.stringify({
      event: "EXECUTOR_BRIDGE_REQUIRED",
      dispatch_id: dispatch.idempotency_key,
      reason: invocation.reason,
      hint: "Set RICK_LOOP_EXECUTOR_KIND=claude-code and optionally RICK_LOOP_EXECUTOR_BIN=claude, then run npm run loop:dispatch.",
    }, null, 2));
    process.exit(2);
  }

  if (!invocation.ok) process.exit(3);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
