import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdirSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { dirname, basename, join } from "node:path";
import { parseRoadmapPlan, resolveNextEligibleTask } from "./rick-loop-roadmap.mjs";

export { parseRoadmapPlan, resolveNextEligibleTask } from "./rick-loop-roadmap.mjs";

const repoRoot = process.cwd();
const RUNTIME_STATE_PATH = ".rick/tmp/loop-runtime.json";
const PREWRITE_STATE_PATH = ".rick/tmp/prewrite.json";
const LOOP_VERSION = "RICK_LOOP_V1_3_2";

export const CANONICAL_TASK_STATES = Object.freeze([
  "READY",
  "SPEC_REQUIRED",
  "IMPLEMENTING",
  "VALIDATING",
  "WAIT_CI",
  "WAIT_REVIEW",
  "REVIEW_LANDED",
  "RECOVERING",
  "READY_TO_MERGE",
  "POST_MERGE_VALIDATION",
  "COMPLETED",
]);

const START_LIKE_STATUSES = new Set(["READY", "READY_TO_START"]);
const DOCS_ONLY_ALLOWLIST = /^docs\/(operations\/(STATE|HANDOFF)\.md|operations\/LOOP-REGISTER\.jsonl|operations\/LESSONS\.md|roadmap\/ROADMAP\.md|evidence\/.*|specs\/TASK-\d+\.md)$/;

export function parseFlatYaml(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const match = normalized.match(/```yaml\n([\s\S]*?)\n```/);
  const body = match ? match[1] : normalized;
  const lines = body.split("\n");
  const result = {};
  let currentListKey = null;

  for (const line of lines) {
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && currentListKey) {
      result[currentListKey].push(listItem[1].trim());
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;

    const [, key, rawValue] = kv;
    if (rawValue === "") {
      result[key] = [];
      currentListKey = key;
      continue;
    }

    currentListKey = null;
    let value = rawValue.trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    else if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (value === "null") value = null;
    else if (/^-?\d+$/.test(value)) value = Number(value);
    result[key] = value;
  }

  return result;
}

export function countRoadmapTasks(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const pending = (normalized.match(/^- \[ \] TASK-\d+/gm) || []).length;
  const done = (normalized.match(/^- \[x\] TASK-\d+/gm) || []).length;
  return { pending, done, total: pending + done };
}

export function classifyDocsOnlyDiff(files) {
  return files.length > 0 && files.every((f) => DOCS_ONLY_ALLOWLIST.test(f));
}

export function taskFromBranch(branch) {
  const match = branch?.match(/(?:^|\/)(TASK-\d+)(?:-|$)/i);
  return match ? match[1].toUpperCase() : null;
}

export function taskSpecPath(task) {
  return task ? `docs/specs/${task}.md` : null;
}

export function selectAnchoredReview(reviews, headOid) {
  if (!Array.isArray(reviews) || !headOid) return null;
  const anchored = reviews.filter((entry) => entry?.commit?.oid === headOid);
  return anchored.length ? anchored[anchored.length - 1] : null;
}

export function selectAnchoredCleanComment(comments, headOid) {
  if (!Array.isArray(comments) || !headOid) return null;
  const clean = comments.filter((entry) => {
    const body = entry?.body ?? "";
    if (!/(did\s*n.?t find any major issues|no major issues)/i.test(body)) return false;
    const named = body.match(/reviewed commit:[^0-9a-zA-Z]{0,8}([0-9a-f]{7,40})/i);
    return named ? headOid.startsWith(named[1]) : false;
  });
  return clean.length ? clean[clean.length - 1] : null;
}

export function evaluateArchitectureComplexitySignal(entries, task, threshold = 5) {
  const rounds = new Set();
  const classes = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.task !== task) continue;
    if (!entry.finding && !entry.finding_2) continue;
    if (entry.review_round === undefined || entry.review_round === null) continue;
    rounds.add(entry.review_round);
    for (const key of ["finding", "finding_2"]) {
      if (entry[key] && !classes.includes(entry[key])) classes.push(entry[key]);
    }
  }
  const count = rounds.size;
  if (count < threshold) return { signal: null, rounds: count, defect_classes: classes };
  return {
    signal: "ARCHITECTURE_COMPLEXITY_SIGNAL",
    blocking: false,
    task,
    rounds: count,
    threshold,
    defect_classes: classes,
    action: "record a follow-up architecture item; continue converging the current task",
  };
}

export function deriveCanonicalTaskState({ git, pr, review, ci }) {
  if (!pr) return taskFromBranch(git?.branch) ? "IMPLEMENTING" : "READY";
  if (pr.state === "MERGED") return "POST_MERGE_VALIDATION";
  if (!ci || ci.status !== "completed") return "WAIT_CI";
  if (ci.conclusion !== "success") return "RECOVERING";
  if (!review || !review.anchored) return "WAIT_REVIEW";
  return "REVIEW_LANDED";
}

function comparablePointer(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.toLowerCase() === "none" || normalized === "" ? null : normalized;
}

export function detectStateDrift({ state, handoff = null, git, pr, prewrite = null }) {
  if (!state) return [];
  const drift = [];
  const branchTask = taskFromBranch(pr?.headRefName ?? git?.branch);

  if (handoff) {
    const stateTask = comparablePointer(state.current_task);
    const handoffTask = comparablePointer(handoff.current_task);
    if (stateTask && handoffTask && stateTask !== handoffTask) {
      drift.push({ code: "HANDOFF_CURRENT_TASK_STALE", message: `HANDOFF current_task ${handoffTask} differs from STATE current_task ${stateTask}` });
    }

    const stateNext = comparablePointer(state.next_eligible_task);
    const handoffNext = comparablePointer(handoff.next_eligible_task);
    if (stateNext && handoffNext && stateNext !== handoffNext) {
      drift.push({ code: "HANDOFF_NEXT_ELIGIBLE_STALE", message: `HANDOFF next_eligible_task ${handoffNext} differs from STATE next_eligible_task ${stateNext}` });
    }

    const stateMode = comparablePointer(state.mode);
    const handoffMode = comparablePointer(handoff.mode);
    if (stateMode && handoffMode && stateMode !== handoffMode) {
      drift.push({ code: "HANDOFF_MODE_STALE", message: `HANDOFF mode ${handoffMode} differs from STATE mode ${stateMode}` });
    }

    const stateBranch = comparablePointer(state.branch);
    const handoffBranch = comparablePointer(handoff.current_branch);
    if (stateBranch && handoffBranch && stateBranch !== handoffBranch) {
      drift.push({ code: "HANDOFF_BRANCH_STALE", message: `HANDOFF current_branch ${handoffBranch} differs from STATE branch ${stateBranch}` });
    }

    const statePr = comparablePointer(state.pr_number);
    const handoffPr = comparablePointer(handoff.current_pr);
    if (statePr && handoffPr && statePr !== handoffPr) {
      drift.push({ code: "HANDOFF_PR_STALE", message: `HANDOFF current_pr ${handoffPr} differs from STATE pr_number ${statePr}` });
    }
  }

  if (pr && pr.state === "OPEN" && START_LIKE_STATUSES.has(String(state.current_task_status ?? ""))) {
    drift.push({ code: "TASK_ALREADY_IN_PROGRESS", message: `${state.current_task} has open PR #${pr.number} but state says ${state.current_task_status}` });
  }
  if (pr?.headRefName && state.branch && taskFromBranch(state.branch) && state.branch !== pr.headRefName) {
    drift.push({ code: "BRANCH_POINTER_STALE", message: `STATE branch ${state.branch} differs from active PR branch ${pr.headRefName}` });
  }
  if (pr?.number && state.pr_number && Number(state.pr_number) !== Number(pr.number)) {
    drift.push({ code: "PR_POINTER_STALE", message: `STATE pr_number ${state.pr_number} differs from active PR #${pr.number}` });
  }
  if (pr && pr.state === "OPEN" && state.next_action === `START_${state.current_task}`) {
    drift.push({ code: "NEXT_ACTION_STALE", message: `next_action cannot start ${state.current_task}; PR #${pr.number} already exists` });
  }
  if (branchTask && state.current_task && branchTask !== state.current_task) {
    drift.push({ code: "TASK_BRANCH_MISMATCH", message: `active branch/PR belongs to ${branchTask}, STATE current_task is ${state.current_task}` });
  }
  if (prewrite?.task && state.current_task && prewrite.task !== state.current_task) {
    drift.push({ code: "PREWRITE_TASK_MISMATCH", message: `active pre-write belongs to ${prewrite.task}, current task is ${state.current_task}` });
  }
  if (prewrite?.target_head && pr?.headRefOid && prewrite.target_head !== pr.headRefOid) {
    drift.push({ code: "PREWRITE_HEAD_STALE", message: `active pre-write targets ${prewrite.target_head}, PR head is ${pr.headRefOid}` });
  }
  return drift;
}

export const WAIT_BACKOFF_SECONDS = [30, 30, 60, 60, 120, 300, 600];

export function backoffSecondsForPollCount(pollCount) {
  const index = Math.min(Math.max(pollCount, 0), WAIT_BACKOFF_SECONDS.length - 1);
  return WAIT_BACKOFF_SECONDS[index];
}

export function startWait({ state, task, prNumber = null, targetHead = null, now = new Date() }) {
  const backoffSeconds = backoffSecondsForPollCount(0);
  return {
    schema_version: "1.1",
    loop_version: LOOP_VERSION,
    state,
    task,
    pr_number: prNumber,
    target_head: targetHead,
    started_at: now.toISOString(),
    last_poll_at: null,
    poll_count: 0,
    backoff_seconds: backoffSeconds,
    next_poll_at: new Date(now.getTime() + backoffSeconds * 1000).toISOString(),
    stagnant_attempt: 0,
    last_error: null,
  };
}

export function recordPoll(runtime, { resolved, error = null, now = new Date() }) {
  if (resolved) return null;
  const pollCount = runtime.poll_count + 1;
  const backoffSeconds = backoffSecondsForPollCount(pollCount);
  return {
    ...runtime,
    poll_count: pollCount,
    last_poll_at: now.toISOString(),
    backoff_seconds: backoffSeconds,
    next_poll_at: new Date(now.getTime() + backoffSeconds * 1000).toISOString(),
    last_error: error,
  };
}

export function nextStagnationState(stagnantAttempt, { progressed, max = 3 }) {
  const nextAttempt = progressed ? 0 : Math.max(0, Number(stagnantAttempt) || 0) + 1;
  return { stagnant_attempt: nextAttempt, max_stagnant_attempts: max, status: nextAttempt >= max ? "HUMAN_REQUIRED" : "CONTINUE" };
}

export function prewriteKey({ task, action, expectedState = null, targetHead = null }) {
  return createHash("sha256").update([task, action, expectedState ?? "", targetHead ?? ""].join("|")).digest("hex").slice(0, 16);
}

export function startPrewrite({ task, action, expectedState = null, targetHead = null, now = new Date() }) {
  if (!task || !action) throw new Error("task and action are required for pre-write");
  return {
    schema_version: "1.0",
    loop_version: LOOP_VERSION,
    idempotency_key: prewriteKey({ task, action, expectedState, targetHead }),
    task,
    action,
    expected_state: expectedState,
    target_head: targetHead,
    started_at: now.toISOString(),
  };
}

export function samePrewriteIntent(a, b) {
  return Boolean(a?.idempotency_key && b?.idempotency_key && a.idempotency_key === b.idempotency_key);
}

export function completePrewrite(prewrite, { resultState = null, now = new Date() } = {}) {
  if (!prewrite) throw new Error("no active pre-write");
  return { ...prewrite, completed_at: now.toISOString(), result_state: resultState };
}

function loadJson(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function saveJsonAtomic(valueOrNull, path) {
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

export function loadRuntimeState(path = RUNTIME_STATE_PATH) { return loadJson(path); }
export function saveRuntimeState(runtimeOrNull, path = RUNTIME_STATE_PATH) { saveJsonAtomic(runtimeOrNull, path); }
export function loadPrewriteState(path = PREWRITE_STATE_PATH) { return loadJson(path); }
export function savePrewriteState(prewriteOrNull, path = PREWRITE_STATE_PATH) { saveJsonAtomic(prewriteOrNull, path); }

function sh(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: "utf8", cwd: repoRoot }).trim(); } catch { return null; }
}

function readState() {
  const path = "docs/operations/STATE.md";
  if (!existsSync(path)) return null;
  return parseFlatYaml(readFileSync(path, "utf8"));
}

function readHandoff() {
  const path = "docs/operations/HANDOFF.md";
  if (!existsSync(path)) return null;
  return parseFlatYaml(readFileSync(path, "utf8"));
}

function readRoadmap() {
  const path = "docs/roadmap/ROADMAP.md";
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  return { ...countRoadmapTasks(text), plan: parseRoadmapPlan(text) };
}

function gitFacts() {
  return { branch: sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]), head: sh("git", ["rev-parse", "HEAD"]), dirty: (sh("git", ["status", "--porcelain"]) || "").length > 0 };
}

function repoSlug() {
  const url = sh("git", ["remote", "get-url", "origin"]);
  const match = url?.match(/github\.com[:/](.+?)(?:\.git)?$/);
  return match ? match[1] : null;
}

function ghAvailable() { return sh("gh", ["--version"]) !== null; }
function parseJson(raw) { if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } }

function findPrForBranch(branch, repo) {
  const list = parseJson(sh("gh", ["pr", "list", "--repo", repo, "--head", branch, "--state", "all", "--json", "number,state,headRefName,headRefOid,mergeable,mergeStateStatus,title", "--limit", "1"]));
  return list?.[0] || null;
}

function findPrForTask(task, repo) {
  const list = parseJson(sh("gh", ["pr", "list", "--repo", repo, "--state", "open", "--json", "number,state,headRefName,headRefOid,mergeable,mergeStateStatus,title", "--limit", "100"]));
  if (!Array.isArray(list)) return null;
  return list.find((candidate) => taskFromBranch(candidate.headRefName) === task || candidate.title?.includes(task)) || null;
}

function readLoopRegister() {
  try {
    const raw = readFileSync(join(repoRoot, "docs", "operations", "LOOP-REGISTER.jsonl"), "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function prReview(number, repo) {
  const data = parseJson(sh("gh", ["pr", "view", String(number), "--repo", repo, "--json", "reviews,comments,headRefOid"]));
  if (!data) return null;
  const anchoredReview = selectAnchoredReview(data.reviews, data.headRefOid);
  const anchoredClean = selectAnchoredCleanComment(data.comments, data.headRefOid);
  return {
    headRefOid: data.headRefOid,
    lastReview: data.reviews?.at(-1) ?? null,
    anchored: anchoredReview ?? anchoredClean,
    anchoredVia: anchoredReview ? "review" : anchoredClean ? "clean_comment" : null,
  };
}

function ciForSha(branch, sha, repo) {
  if (!branch || !sha) return null;
  const runs = parseJson(sh("gh", ["run", "list", "--repo", repo, "--branch", branch, "--limit", "20", "--json", "databaseId,headSha,status,conclusion"]));
  return Array.isArray(runs) ? runs.find((r) => r.headSha === sha) || null : null;
}

export function classifyLoopDecision(state, roadmap, git, pr, review, ci, { drift, taskSpecPresent, effectiveTask, taskSelection }) {
  if (!state) return { transition: "HUMAN_REQUIRED", reason: "docs/operations/STATE.md missing or unreadable" };
  if (git.dirty) return { transition: "HUMAN_REQUIRED", reason: "working tree has uncommitted changes; reconcile before continuing" };
  if (drift.length > 0) return { transition: "STATE_DRIFT_DETECTED", reason: "repository/STATE/HANDOFF facts contradict persisted loop state; reconcile deterministic pointers before any write", drift };
  if (roadmap && roadmap.pending === 0 && roadmap.total > 0) return { transition: "ROADMAP_COMPLETE", reason: "no pending TASK entries remain in ROADMAP.md" };

  if (!pr && effectiveTask && state.current_task && effectiveTask !== state.current_task) {
    return {
      transition: "TASK_ADVANCE",
      task: effectiveTask,
      reason: `${state.current_task} is not currently eligible; deterministically advance to ${effectiveTask}`,
      skipped: taskSelection?.skipped ?? [],
    };
  }

  if (!effectiveTask) {
    return {
      transition: "NO_ELIGIBLE_TASK",
      reason: "pending tasks exist but every candidate is blocked by unresolved dependencies or explicit task-scoped blockers",
      skipped: taskSelection?.skipped ?? [],
    };
  }

  if (!taskSpecPresent) return { transition: "SPEC_REQUIRED", task: effectiveTask, reason: `${taskSpecPath(effectiveTask)} is required before implementation/recovery writes` };
  if (!pr) return { transition: "PASS", task: effectiveTask, reason: `no active PR found; proceed with ${effectiveTask} from the task spec` };
  if (pr.state === "MERGED") return { transition: "POST_MERGE_VALIDATION", reason: `PR #${pr.number} merged; validate main before advancing` };
  if (!ci) return { transition: "EXTERNAL_RETRYABLE", reason: "no CI run found yet for current PR HEAD" };
  if (ci.status !== "completed") return { transition: "WAIT_FOR_CI", reason: `CI run ${ci.databaseId} still ${ci.status}` };
  if (ci.conclusion !== "success") return { transition: "RECOVERABLE_FAILURE", reason: `CI run ${ci.databaseId} concluded ${ci.conclusion}` };
  if (!review || !review.anchored) return { transition: "WAIT_FOR_CODEX", reason: "no independent review anchored to the exact current PR HEAD; request @codex review and poll. A result for an older SHA is evidence only and does not satisfy this gate" };
  return { transition: "REVIEW_LANDED", reason: "review anchored to the exact current PR HEAD; inspect inline findings and classify PASS vs RECOVERING", review: review.anchored };
}

function reconcile() {
  const state = readState();
  const handoff = readHandoff();
  const roadmap = readRoadmap();
  const taskSelection = roadmap?.plan ? resolveNextEligibleTask(roadmap.plan) : { task: state?.current_task ?? null, reason: "STATE_FALLBACK", skipped: [] };
  const git = gitFacts();
  const repo = repoSlug();
  const hasGh = ghAvailable();
  const branchTask = taskFromBranch(git.branch);
  const isTaskBranch = /^(feat|fix)\/TASK-\d+/.test(git.branch ?? "");
  let pr = null;

  if (hasGh && repo) {
    pr = isTaskBranch ? findPrForBranch(git.branch, repo) : null;
    if (!pr && state?.current_task) pr = findPrForTask(state.current_task, repo);
    if (!pr && taskSelection.task && taskSelection.task !== state?.current_task) pr = findPrForTask(taskSelection.task, repo);
  }

  const effectiveTask = taskFromBranch(pr?.headRefName) ?? branchTask ?? taskSelection.task ?? state?.current_task ?? null;
  const review = pr && repo ? prReview(pr.number, repo) : null;
  const ciBranch = pr?.headRefName ?? git.branch;
  const ciHead = pr?.headRefOid ?? git.head;
  const ci = pr && repo ? ciForSha(ciBranch, ciHead, repo) : null;
  const prewrite = loadPrewriteState();
  const drift = detectStateDrift({ state, handoff, git, pr, prewrite });
  const taskSpec = taskSpecPath(effectiveTask);
  const taskSpecPresent = taskSpec ? existsSync(taskSpec) : false;
  const canonicalTaskState = deriveCanonicalTaskState({ git, pr, review, ci });
  const decision = classifyLoopDecision(state, roadmap, git, pr, review, ci, { drift, taskSpecPresent, effectiveTask, taskSelection });
  const architectureSignal = evaluateArchitectureComplexitySignal(readLoopRegister(), effectiveTask);
  const writeTransitions = new Set(["TASK_ADVANCE", "PASS", "REVIEW_LANDED", "RECOVERABLE_FAILURE", "POST_MERGE_VALIDATION"]);

  return {
    generated_at: new Date().toISOString(),
    loop_version: LOOP_VERSION,
    state_summary: state ? {
      mode: state.mode,
      current_task: state.current_task,
      persisted_task_status: state.current_task_status ?? null,
      canonical_task_state: canonicalTaskState,
      next_eligible_task: state.next_eligible_task,
      resolved_task: effectiveTask,
      roadmap_next_eligible_task: taskSelection.task,
      next_action: state.next_action,
      completed_tasks: state.completed_tasks,
    } : null,
    handoff_summary: handoff ? {
      current_task: handoff.current_task ?? null,
      current_task_status: handoff.current_task_status ?? null,
      next_eligible_task: handoff.next_eligible_task ?? null,
      current_branch: handoff.current_branch ?? null,
      current_pr: handoff.current_pr ?? null,
    } : null,
    roadmap_summary: roadmap ? { pending: roadmap.pending, done: roadmap.done, total: roadmap.total } : null,
    task_selection: taskSelection,
    git,
    gh_available: hasGh,
    pr: pr ? { number: pr.number, state: pr.state, headRefName: pr.headRefName, headRefOid: pr.headRefOid, mergeable: pr.mergeable } : null,
    review: review?.anchored
      ? { submittedAt: review.anchored.submittedAt ?? review.anchored.createdAt ?? null, commit: review.anchored.commit?.oid ?? pr?.headRefOid ?? null, anchored_to_head: true, via: review.anchoredVia }
      : review?.lastReview
        ? { submittedAt: review.lastReview.submittedAt, commit: review.lastReview.commit?.oid ?? null, anchored_to_head: false, note: "evidence only; does not satisfy the review gate for the current HEAD" }
        : null,
    architecture_signal: architectureSignal,
    ci: ci ? { id: ci.databaseId, status: ci.status, conclusion: ci.conclusion, headSha: ci.headSha } : null,
    task_spec: { path: taskSpec, present: taskSpecPresent },
    state_drift: drift,
    decision,
    prewrite_required_before_write: writeTransitions.has(decision.transition),
    active_prewrite: prewrite,
    runtime_wait: loadRuntimeState(),
  };
}

function main() {
  const [, , subcommand, ...rest] = process.argv;
  if (subcommand === "docs-only-diff") {
    const [a, b] = rest;
    if (!a || !b) { console.error("Usage: rick-loop-controller.mjs docs-only-diff <from-sha> <to-sha>"); process.exit(1); }
    const files = (sh("git", ["diff", "--name-only", a, b]) || "").split("\n").filter(Boolean);
    console.log(JSON.stringify({ from: a, to: b, files, docsOnly: classifyDocsOnlyDiff(files) }, null, 2));
    return;
  }
  if (subcommand === "wait") {
    const [action, ...waitArgs] = rest;
    if (action === "status") { console.log(JSON.stringify(loadRuntimeState() ?? { active: false }, null, 2)); return; }
    if (action === "clear") { saveRuntimeState(null); console.log(JSON.stringify({ cleared: true }, null, 2)); return; }
    if (action === "start") {
      const [state, task, prNumber, targetHead] = waitArgs;
      if (!state || !task) { console.error("Usage: rick-loop-controller.mjs wait start <WAIT_STATE> <task> [prNumber] [targetHead]"); process.exit(1); }
      const runtime = startWait({ state, task, prNumber: prNumber ? Number(prNumber) : null, targetHead: targetHead ?? null });
      saveRuntimeState(runtime); console.log(JSON.stringify(runtime, null, 2)); return;
    }
    if (action === "poll") {
      const [outcome, error] = waitArgs;
      if (outcome !== "resolved" && outcome !== "pending") { console.error("Usage: rick-loop-controller.mjs wait poll <resolved|pending> [error]"); process.exit(1); }
      const runtime = loadRuntimeState();
      if (!runtime) { console.error("No active wait to poll. Run `wait start` first."); process.exit(1); }
      const next = recordPoll(runtime, { resolved: outcome === "resolved", error: error ?? null });
      saveRuntimeState(next); console.log(JSON.stringify(next ?? { resolved: true }, null, 2)); return;
    }
    console.error("Usage: rick-loop-controller.mjs wait <status|start|poll|clear>"); process.exit(1);
  }
  if (subcommand === "prewrite") {
    const [action, ...prewriteArgs] = rest;
    if (action === "status") { console.log(JSON.stringify(loadPrewriteState() ?? { active: false }, null, 2)); return; }
    if (action === "clear") { savePrewriteState(null); console.log(JSON.stringify({ cleared: true }, null, 2)); return; }
    if (action === "start") {
      const [task, intendedAction, expectedState, targetHead] = prewriteArgs;
      if (!task || !intendedAction) { console.error("Usage: rick-loop-controller.mjs prewrite start <task> <action> [expectedState] [targetHead]"); process.exit(1); }
      const proposed = startPrewrite({ task, action: intendedAction, expectedState: expectedState ?? null, targetHead: targetHead ?? null });
      const active = loadPrewriteState();
      if (active) {
        if (samePrewriteIntent(active, proposed)) { console.log(JSON.stringify({ ...active, idempotent_reuse: true }, null, 2)); return; }
        console.error(`Active pre-write ${active.idempotency_key} must be completed or cleared before starting another intent.`); process.exit(2);
      }
      savePrewriteState(proposed); console.log(JSON.stringify(proposed, null, 2)); return;
    }
    if (action === "complete") {
      const [resultState] = prewriteArgs;
      const active = loadPrewriteState();
      if (!active) { console.error("No active pre-write to complete."); process.exit(1); }
      const completed = completePrewrite(active, { resultState: resultState ?? null });
      savePrewriteState(null); console.log(JSON.stringify(completed, null, 2)); return;
    }
    console.error("Usage: rick-loop-controller.mjs prewrite <status|start|complete|clear>"); process.exit(1);
  }
  if (subcommand === "stagnation") {
    const [outcome, currentRaw = "0", maxRaw = "3"] = rest;
    if (outcome !== "progress" && outcome !== "stagnant") { console.error("Usage: rick-loop-controller.mjs stagnation <progress|stagnant> [current] [max]"); process.exit(1); }
    console.log(JSON.stringify(nextStagnationState(Number(currentRaw), { progressed: outcome === "progress", max: Number(maxRaw) }), null, 2)); return;
  }
  console.log(JSON.stringify(reconcile(), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
