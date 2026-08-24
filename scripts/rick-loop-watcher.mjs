import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const RETRY_DELAYS_SECONDS = Object.freeze([30, 60, 300, 600, 1800, 3600]);
const REVIEW_RETRY_COOLDOWN_MS = 60 * 60 * 1000;

function sh(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function retryDelaySeconds(cycle) {
  return RETRY_DELAYS_SECONDS[Math.min(Math.max(Number(cycle) || 0, 0), RETRY_DELAYS_SECONDS.length - 1)];
}

function supervisor() {
  return JSON.parse(sh(process.execPath, ["scripts/rick-loop-supervisor.mjs"]));
}

function rawWaitIdentity(snapshot) {
  const decision = snapshot?.decision ?? {};
  const raw = snapshot?.controller ?? {};
  return {
    state: decision.waited_transition ?? null,
    task: raw?.state_summary?.resolved_task ?? raw?.state_summary?.current_task ?? null,
    pr: raw?.pr?.number ?? decision.pr_number ?? null,
    head: raw?.pr?.headRefOid ?? raw?.git?.head ?? null,
  };
}

function ensureRuntimeWait(snapshot) {
  const identity = rawWaitIdentity(snapshot);
  if (!identity.state || !identity.task) return;
  const runtime = snapshot?.controller?.runtime_wait;
  const matches = Boolean(
    runtime
    && runtime.state === identity.state
    && runtime.task === identity.task
    && (identity.pr == null || Number(runtime.pr_number) === Number(identity.pr))
    && (identity.head == null || runtime.target_head === identity.head),
  );
  if (matches) return;
  const args = ["scripts/rick-loop-controller.mjs", "wait", "start", identity.state, identity.task];
  if (identity.pr != null) args.push(String(identity.pr));
  if (identity.head != null) args.push(identity.head);
  sh(process.execPath, args);
}

function recordPending(reason) {
  try { sh(process.execPath, ["scripts/rick-loop-controller.mjs", "wait", "poll", "pending", String(reason ?? "pending")]); } catch { /* checkpoint is advisory; facts remain authoritative */ }
}

function clearWait() {
  try { sh(process.execPath, ["scripts/rick-loop-controller.mjs", "wait", "clear"]); } catch { /* no active runtime wait */ }
}

function requestCodexReview(prNumber) {
  if (!prNumber) return false;
  try {
    sh("gh", ["pr", "comment", String(prNumber), "--body", "@codex review"]);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const maxCyclesEnv = Number(process.env.RICK_LOOP_WATCH_MAX_CYCLES ?? 0);
  const maxCycles = Number.isInteger(maxCyclesEnv) && maxCyclesEnv > 0 ? maxCyclesEnv : Infinity;
  let cycle = 0;
  let lastReviewRequestAt = 0;

  while (cycle < maxCycles) {
    const snapshot = supervisor();
    const decision = snapshot?.decision ?? {};

    if (decision.transition !== "PARKED_EXTERNAL_RETRYABLE") {
      clearWait();
      console.log(JSON.stringify({ resolved: true, cycle, next: decision, snapshot }, null, 2));
      return;
    }

    ensureRuntimeWait(snapshot);
    const identity = rawWaitIdentity(snapshot);
    const now = Date.now();
    if (identity.state === "WAIT_FOR_CODEX" && identity.pr && (lastReviewRequestAt === 0 || now - lastReviewRequestAt >= REVIEW_RETRY_COOLDOWN_MS)) {
      if (requestCodexReview(identity.pr)) lastReviewRequestAt = now;
    }

    recordPending(decision.reason);
    const seconds = retryDelaySeconds(cycle);
    console.log(JSON.stringify({
      parked: true,
      cycle,
      state: identity.state,
      task: identity.task,
      pr_number: identity.pr,
      head: identity.head,
      next_poll_seconds: seconds,
      human_required: false,
    }));
    cycle += 1;
    await sleep(seconds * 1000);
  }

  console.error("Watcher test cycle limit reached; production watcher has no retry budget terminality.");
  process.exitCode = 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
