import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { fetchIssueComments, hasVerdictForHead } from "./rick-loop-review-dispatch.mjs";

const RETRY_DELAYS_SECONDS = Object.freeze([30, 60, 300, 600, 1800, 3600]);
export const REVIEW_RETRY_COOLDOWN_MS = 60 * 60 * 1000;
export const CLAUDE_REVIEW_WORKFLOW = "claude-pr-review.yml";

function sh(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function retryDelaySeconds(cycle) {
  return RETRY_DELAYS_SECONDS[Math.min(Math.max(Number(cycle) || 0, 0), RETRY_DELAYS_SECONDS.length - 1)];
}

export function selectClaudeReviewRun(runs, head) {
  if (!Array.isArray(runs) || !head) return null;
  return runs.find((run) => run?.headSha === head) ?? null;
}

export function claudeReviewRetryAction(run, { now = new Date(), cooldownMs = REVIEW_RETRY_COOLDOWN_MS } = {}) {
  if (!run) return "NO_RUN";
  if (["queued", "in_progress", "waiting", "pending"].includes(run.status)) return "WAIT";
  if (run.status !== "completed") return "WAIT";
  const timestamp = Date.parse(run.updatedAt ?? run.createdAt ?? "");
  if (!Number.isFinite(timestamp)) return "WAIT";
  if (now.getTime() - timestamp < cooldownMs) return "COOLDOWN";
  return "RERUN";
}

/**
 * ARCH-04: matching a run by headSha alone is not enough to decide what to do
 * with it. `gh workflow run --ref <branch>` resolves the branch tip at
 * dispatch time, so a push landing mid-dispatch produces a run associated with
 * the NEW head while carrying the OLD one as expected_head_sha. That run skips
 * (correctly - it must not review a stale commit) but still matches the new
 * head forever after. Deciding on headSha alone would then loop
 * WAIT -> COOLDOWN -> RERUN indefinitely, and because rerunning replays the
 * same baked-in stale input, the new head could never receive a review.
 *
 * So the decision also consults whether a verdict was ever published for this
 * exact head, and prefers re-dispatching (which resolves a fresh expected head)
 * over rerunning (which cannot).
 */
export function claudeReviewAction({
  run,
  verdictPublished = false,
  now = new Date(),
  cooldownMs = REVIEW_RETRY_COOLDOWN_MS,
} = {}) {
  // Checked before the run itself, for the same reason as classifyExistingRun:
  // the run that produced a verdict ages out of the `--limit 20` window, and
  // asking about the run first would dispatch a fresh review for a HEAD that
  // already has one.
  if (verdictPublished) return "REVIEWED";
  if (!run) return "DISPATCH";
  if (["queued", "in_progress", "waiting", "pending"].includes(run.status)) return "WAIT";
  if (run.status !== "completed") return "WAIT";
  const timestamp = Date.parse(run.updatedAt ?? run.createdAt ?? "");
  // Unknown age waits rather than acting on evidence it cannot date.
  if (!Number.isFinite(timestamp)) return "WAIT";
  if (now.getTime() - timestamp < cooldownMs) return "COOLDOWN";
  // Completed, nothing published, cooldown elapsed: either a stale dispatch or
  // an infrastructure failure. Re-dispatching fixes both, because it resolves
  // the expected head fresh; rerunning only fixes the second.
  return "REDISPATCH";
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
    branch: raw?.pr?.headRefName ?? raw?.git?.branch ?? null,
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

/**
 * A blocked dispatch and a failed one exit non-zero alike, but they mean
 * opposite things during rollout: BLOCKED is the dispatcher's own pre-checks
 * refusing (normal, not yet ready), while DISPATCH_FAILED means the
 * pre-checks passed and the `gh workflow run` call itself failed - the
 * expected shape while claude-pr-review.yml still has no workflow_dispatch
 * trigger. Exported so the distinction is pinned by a test rather than only
 * by the code that happens to read it.
 */
export function classifyDispatchOutcome(report) {
  if (!report) return "ERROR";
  return report.dispatch === true ? "DISPATCH_FAILED" : "BLOCKED";
}

// ARCH-04: no run exists for this HEAD because a push no longer triggers one.
// The controller owns dispatch now, so NO_RUN is the watcher's cue to act
// rather than to keep observing. The dispatcher re-verifies CI and preflight
// itself and refuses to dispatch twice for the same HEAD, so calling it on
// every cycle while no run is visible is safe.
function dispatchClaudeReview(identity) {
  if (!identity?.pr) return { dispatched: false, reason: "NO_PR" };
  try {
    const raw = sh(process.execPath, ["scripts/rick-loop-review-dispatch.mjs", String(identity.pr)]);
    return { dispatched: true, report: raw ? JSON.parse(raw) : null };
  } catch (error) {
    // A blocked dispatch exits non-zero with its named blockers on stdout;
    // that is a normal not-yet-ready state, not a watcher failure.
    const stdout = error?.stdout ? String(error.stdout).trim() : null;
    let report = null;
    try { report = stdout ? JSON.parse(stdout) : null; } catch { report = null; }
    const reason = classifyDispatchOutcome(report);
    if (reason === "ERROR") return { dispatched: false, reason, report: null, error: String(error?.message ?? error) };
    return { dispatched: false, reason, report, error: null };
  }
}

function fetchVerdictPublished(identity) {
  if (!identity?.pr || !identity?.head) return false;
  try {
    // Paged deliberately: issue comments come back oldest-first, so a single
    // page would drop the newest ones - exactly where a verdict for the
    // current HEAD lives on a long-running PR - and report "no verdict" for a
    // HEAD that was actually reviewed.
    return hasVerdictForHead(fetchIssueComments(identity.pr), identity.head);
  } catch {
    // Unknown verdict evidence: treat as "not published" so the loop keeps
    // trying to obtain a review rather than assuming one exists. Bounded by
    // the retry cooldown, so an API outage costs at most one extra review per
    // window rather than stalling the head forever.
    return false;
  }
}

function retryClaudeReview(identity, now = new Date()) {
  if (!identity?.head || !identity?.branch) return { action: "NO_IDENTITY" };
  try {
    const raw = sh("gh", ["run", "list", "--workflow", CLAUDE_REVIEW_WORKFLOW, "--branch", identity.branch, "--limit", "20", "--json", "databaseId,headSha,status,conclusion,createdAt,updatedAt"]);
    const runs = raw ? JSON.parse(raw) : [];
    const run = selectClaudeReviewRun(runs, identity.head);
    const verdictPublished = fetchVerdictPublished(identity);
    const action = claudeReviewAction({ run, verdictPublished, now });
    const base = {
      action,
      run_id: run?.databaseId ?? null,
      status: run?.status ?? null,
      conclusion: run?.conclusion ?? null,
      last_run_at: run?.updatedAt ?? run?.createdAt ?? null,
      verdict_published: verdictPublished,
    };

    if (action === "DISPATCH") return { ...base, dispatch: dispatchClaudeReview(identity) };

    if (action === "REDISPATCH") {
      const dispatch = dispatchClaudeReview(identity);
      if (dispatch.dispatched) return { ...base, dispatch };
      // Until the cutover lands, claude-pr-review.yml has no workflow_dispatch
      // trigger, so dispatch cannot succeed. Fall back to the pre-ARCH-04
      // behaviour rather than losing retry capability during the bootstrap.
      if (run) {
        sh("gh", ["run", "rerun", String(run.databaseId)]);
        return { ...base, action: "RERUN_FALLBACK", dispatch };
      }
      return { ...base, dispatch };
    }

    return base;
  } catch (error) {
    return { action: "ERROR", error: String(error?.message ?? error) };
  }
}

async function main() {
  const maxCyclesEnv = Number(process.env.RICK_LOOP_WATCH_MAX_CYCLES ?? 0);
  const maxCycles = Number.isInteger(maxCyclesEnv) && maxCyclesEnv > 0 ? maxCyclesEnv : Infinity;
  let cycle = 0;

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
    const reviewRetry = identity.state === "WAIT_FOR_CODEX" && identity.pr ? retryClaudeReview(identity) : null;

    recordPending(decision.reason);
    const seconds = retryDelaySeconds(cycle);
    console.log(JSON.stringify({
      parked: true,
      cycle,
      state: identity.state,
      compatibility_state: identity.state === "WAIT_FOR_CODEX" ? "WAIT_FOR_INDEPENDENT_REVIEW" : null,
      review_provider: identity.state === "WAIT_FOR_CODEX" ? "CLAUDE_CODE_ACTION" : null,
      review_retry: reviewRetry,
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
