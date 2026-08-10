import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();

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
  };
}

function main() {
  const [, , subcommand, a, b] = process.argv;

  if (subcommand === "docs-only-diff") {
    if (!a || !b) {
      console.error("Usage: rick-loop-controller.mjs docs-only-diff <from-sha> <to-sha>");
      process.exit(1);
    }
    const files = (sh("git", ["diff", "--name-only", a, b]) || "").split("\n").filter(Boolean);
    const docsOnly = classifyDocsOnlyDiff(files);
    console.log(JSON.stringify({ from: a, to: b, files, docsOnly }, null, 2));
    return;
  }

  console.log(JSON.stringify(reconcile(), null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
