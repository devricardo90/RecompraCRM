import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdirSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { dirname, basename, join } from "node:path";

const repoRoot = process.cwd();
const RUNTIME_STATE_PATH = ".rick/tmp/loop-runtime.json";

// STATE.md/ROADMAP.md only use a restricted YAML subset (flat scalars and
// "key:\n  - item" lists), so a small dedicated parser avoids a new
// dependency for a single fenced block per file.
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

const DOCS_ONLY_ALLOWLIST = /^docs\/(operations\/(STATE|HANDOFF)\.md|operations\/LOOP-REGISTER\.jsonl|operations\/LESSONS\.md|roadmap\/ROADMAP\.md|evidence\/.*)$/;

export function classifyDocsOnlyDiff(files) {
  return files.length > 0 && files.every((f) => DOCS_ONLY_ALLOWLIST.test(f));
}

// Bounded backoff for WAIT_FOR_CI / WAIT_FOR_CODEX / WAIT_FOR_GITHUB /
// EXTERNAL_RETRYABLE. poll_count is how many *pending* polls have happened
// so far (0 before the first poll); the sequence caps at its last value.
export const WAIT_BACKOFF_SECONDS = [30, 30, 60, 60, 120, 300, 600];

export function backoffSecondsForPollCount(pollCount) {
  const index = Math.min(Math.max(pollCount, 0), WAIT_BACKOFF_SECONDS.length - 1);
  return WAIT_BACKOFF_SECONDS[index];
}

// Pure, no I/O, no real time dependency beyond an injectable `now` - this is
// what the deterministic tests exercise without sleeping.
export function startWait({ state, task, prNumber = null, targetHead = null, now = new Date() }) {
  const backoffSeconds = backoffSecondsForPollCount(0);
  return {
    schema_version: "1.0",
    loop_version: "RICK_LOOP_V1_2",
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

// Returns the next runtime state to persist, or null when the wait resolves
// (caller should clear the runtime file). Never touches stagnant_attempt -
// waiting on an external service is never a stagnant attempt.
export function recordPoll(runtime, { resolved, error = null, now = new Date() }) {
  if (resolved) {
    return null;
  }

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

export function loadRuntimeState(path = RUNTIME_STATE_PATH) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// Codex P2: writeFileSync truncates the destination before writing, so a
// process death mid-write - the exact restart scenario this persistence is
// meant to survive - could leave truncated JSON that loadRuntimeState's
// parse failure silently converts to null, losing the wait's backoff/task
// identity. Write to a temp file in the same directory and rename it over
// the target: rename is atomic, so a reader always sees either the old
// complete file or the new complete file, never a partial one.
export function saveRuntimeState(runtimeOrNull, path = RUNTIME_STATE_PATH) {
  if (runtimeOrNull === null) {
    if (existsSync(path)) unlinkSync(path);
    return;
  }

  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tempPath = join(dir, `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(tempPath, `${JSON.stringify(runtimeOrNull, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
}

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", cwd: repoRoot }).trim();
  } catch {
    return null;
  }
}

function readState() {
  const path = "docs/operations/STATE.md";
  if (!existsSync(path)) return null;
  return parseFlatYaml(readFileSync(path, "utf8"));
}

function readRoadmap() {
  const path = "docs/roadmap/ROADMAP.md";
  if (!existsSync(path)) return null;
  return countRoadmapTasks(readFileSync(path, "utf8"));
}

function gitFacts() {
  return {
    branch: sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
    head: sh("git", ["rev-parse", "HEAD"]),
    dirty: (sh("git", ["status", "--porcelain"]) || "").length > 0,
  };
}

function repoSlug() {
  const url = sh("git", ["remote", "get-url", "origin"]);
  const match = url?.match(/github\.com[:/](.+?)(?:\.git)?$/);
  return match ? match[1] : null;
}

function ghAvailable() {
  return sh("gh", ["--version"]) !== null;
}

function findPrForBranch(branch, repo) {
  const raw = sh("gh", [
    "pr", "list", "--repo", repo, "--head", branch, "--state", "all",
    "--json", "number,state,headRefOid,mergeable,mergeStateStatus", "--limit", "1",
  ]);
  if (!raw) return null;
  const list = JSON.parse(raw);
  return list[0] || null;
}

function prReview(number, repo) {
  const raw = sh("gh", ["pr", "view", String(number), "--repo", repo, "--json", "reviews,headRefOid"]);
  if (!raw) return null;
  const data = JSON.parse(raw);
  return { headRefOid: data.headRefOid, lastReview: data.reviews?.at(-1) ?? null };
}

function ciForSha(branch, sha, repo) {
  const raw = sh("gh", [
    "run", "list", "--repo", repo, "--branch", branch, "--limit", "10",
    "--json", "databaseId,headSha,status,conclusion",
  ]);
  if (!raw) return null;
  const runs = JSON.parse(raw);
  return runs.find((r) => r.headSha === sha) || null;
}

function classify(state, roadmap, git, pr, review, ci) {
  if (!state) {
    return { transition: "HUMAN_REQUIRED", reason: "docs/operations/STATE.md missing or unreadable" };
  }
  if (git.dirty) {
    return { transition: "HUMAN_REQUIRED", reason: "working tree has uncommitted changes; reconcile before continuing" };
  }
  if (roadmap && roadmap.pending === 0 && roadmap.total > 0) {
    return { transition: "ROADMAP_COMPLETE", reason: "no pending TASK entries remain in ROADMAP.md" };
  }
  if (!pr) {
    return { transition: "PASS", reason: `no PR found for branch ${git.branch}; proceed with implementation/commit/push for ${state.current_task}` };
  }
  if (pr.state === "MERGED") {
    return { transition: "PASS", reason: `PR #${pr.number} already merged; advance to next_eligible_task (${state.next_eligible_task})` };
  }
  if (!ci) {
    return { transition: "EXTERNAL_RETRYABLE", reason: "no CI run found yet for current HEAD" };
  }
  if (ci.status !== "completed") {
    return { transition: "WAIT_FOR_CI", reason: `CI run ${ci.databaseId} still ${ci.status}` };
  }
  if (ci.conclusion !== "success") {
    return { transition: "RECOVERABLE_FAILURE", reason: `CI run ${ci.databaseId} concluded ${ci.conclusion}` };
  }
  if (!review || review.headRefOid !== git.head) {
    return { transition: "WAIT_FOR_CODEX", reason: "no independent review yet for current HEAD; request @codex review and poll" };
  }
  return {
    transition: "REVIEW_LANDED",
    reason: "review exists for current HEAD; inspect its inline comments to classify PASS vs RECOVERABLE_WITH_PROGRESS",
    review: review.lastReview,
  };
}

function reconcile() {
  const state = readState();
  const roadmap = readRoadmap();
  const git = gitFacts();
  const repo = repoSlug();
  const hasGh = ghAvailable();
  const isTaskBranch = /^(feat|fix)\/TASK-\d+/.test(git.branch ?? "");
  const pr = hasGh && repo && isTaskBranch ? findPrForBranch(git.branch, repo) : null;
  const review = pr && repo ? prReview(pr.number, repo) : null;
  const ci = pr && repo ? ciForSha(git.branch, git.head, repo) : null;
  const decision = classify(state, roadmap, git, pr, review, ci);

  return {
    generated_at: new Date().toISOString(),
    state_summary: state
      ? {
          mode: state.mode,
          current_task: state.current_task,
          next_eligible_task: state.next_eligible_task,
          next_action: state.next_action,
          completed_tasks: state.completed_tasks,
        }
      : null,
    roadmap_summary: roadmap,
    git,
    gh_available: hasGh,
    pr: pr ? { number: pr.number, state: pr.state, headRefOid: pr.headRefOid, mergeable: pr.mergeable } : null,
    review: review?.lastReview
      ? { submittedAt: review.lastReview.submittedAt, commit: review.lastReview.commit?.oid ?? null }
      : null,
    ci: ci ? { id: ci.databaseId, status: ci.status, conclusion: ci.conclusion } : null,
    decision,
    runtime_wait: loadRuntimeState(),
  };
}

function main() {
  const [, , subcommand, ...rest] = process.argv;

  if (subcommand === "docs-only-diff") {
    const [a, b] = rest;
    if (!a || !b) {
      console.error("Usage: rick-loop-controller.mjs docs-only-diff <from-sha> <to-sha>");
      process.exit(1);
    }
    const files = (sh("git", ["diff", "--name-only", a, b]) || "").split("\n").filter(Boolean);
    const docsOnly = classifyDocsOnlyDiff(files);
    console.log(JSON.stringify({ from: a, to: b, files, docsOnly }, null, 2));
    return;
  }

  if (subcommand === "wait") {
    const [action, ...waitArgs] = rest;

    if (action === "status") {
      const runtime = loadRuntimeState();
      console.log(JSON.stringify(runtime ?? { active: false }, null, 2));
      return;
    }

    if (action === "clear") {
      saveRuntimeState(null);
      console.log(JSON.stringify({ cleared: true }, null, 2));
      return;
    }

    if (action === "start") {
      const [state, task, prNumber, targetHead] = waitArgs;
      if (!state || !task) {
        console.error("Usage: rick-loop-controller.mjs wait start <WAIT_STATE> <task> [prNumber] [targetHead]");
        process.exit(1);
      }
      const runtime = startWait({
        state,
        task,
        prNumber: prNumber ? Number(prNumber) : null,
        targetHead: targetHead ?? null,
      });
      saveRuntimeState(runtime);
      console.log(JSON.stringify(runtime, null, 2));
      return;
    }

    if (action === "poll") {
      const [outcome, error] = waitArgs;
      if (outcome !== "resolved" && outcome !== "pending") {
        console.error("Usage: rick-loop-controller.mjs wait poll <resolved|pending> [error]");
        process.exit(1);
      }
      const runtime = loadRuntimeState();
      if (!runtime) {
        console.error("No active wait to poll. Run `wait start` first.");
        process.exit(1);
      }
      const next = recordPoll(runtime, { resolved: outcome === "resolved", error: error ?? null });
      saveRuntimeState(next);
      console.log(JSON.stringify(next ?? { resolved: true }, null, 2));
      return;
    }

    console.error("Usage: rick-loop-controller.mjs wait <status|start|poll|clear>");
    process.exit(1);
  }

  console.log(JSON.stringify(reconcile(), null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
