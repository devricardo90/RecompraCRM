import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { collectPreflightInputs, evaluatePreflight } from "./rick-loop-preflight.mjs";

/**
 * ARCH-04: the controller-owned review dispatch. A push alone never invokes
 * Claude; this is the only thing that does, and only once CI, validation and
 * the deterministic preflight have all passed for the exact HEAD.
 */

export const CLAUDE_REVIEW_WORKFLOW = "claude-pr-review.yml";
export const VALIDATE_WORKFLOW_NAME = "Validate";

export const DISPATCH_BLOCKERS = Object.freeze([
  "pr_missing",
  "pr_not_open",
  "draft",
  "conflicting",
  "head_unknown",
  "ci_not_green",
  "preflight_failed",
  "already_dispatched",
]);

/**
 * An existing run for the exact HEAD - in any status - means this HEAD has
 * already been dispatched. Retrying a run that exists but failed belongs to
 * the watcher's retryClaudeReview/RERUN path, not here.
 */
export function findRunForHead(runs, headSha) {
  if (!Array.isArray(runs) || !headSha) return null;
  return runs.find((run) => run?.headSha === headSha) ?? null;
}

export function evaluateDispatch({ pr = null, ci = null, preflight = null, existingRuns = null } = {}) {
  const blockers = [];

  if (!pr) blockers.push("pr_missing");
  else {
    if (pr.state !== "OPEN") blockers.push("pr_not_open");
    if (pr.isDraft === true) blockers.push("draft");
    if (pr.mergeable === "CONFLICTING") blockers.push("conflicting");
    if (!pr.headRefOid || !pr.headRefName) blockers.push("head_unknown");
  }

  const ciGreen = Boolean(
    pr?.headRefOid
    && ci?.headSha === pr.headRefOid
    && ci?.status === "completed"
    && ci?.conclusion === "success",
  );
  if (!ciGreen) blockers.push("ci_not_green");

  if (preflight?.pass !== true) blockers.push("preflight_failed");

  // An unreadable run list is unknown evidence, not proof that nothing was
  // dispatched; dispatching on unknown would risk a duplicate, so it blocks.
  if (!Array.isArray(existingRuns)) blockers.push("already_dispatched");
  else if (findRunForHead(existingRuns, pr?.headRefOid)) blockers.push("already_dispatched");

  return {
    dispatch: blockers.length === 0,
    blockers,
    head: pr?.headRefOid ?? null,
    branch: pr?.headRefName ?? null,
  };
}

/**
 * --ref is not optional: without it `gh workflow run` runs the workflow from
 * the repository's default branch and GitHub records the resulting run against
 * that branch, so neither this script's own idempotency query nor the
 * watcher's selectClaudeReviewRun (both of which filter by the PR branch and
 * match on headSha) would ever find it again.
 */
export function buildDispatchArgs({ workflow = CLAUDE_REVIEW_WORKFLOW, branch, prNumber, headSha, repo = null }) {
  if (!branch) throw new Error("dispatch requires the PR branch for --ref");
  if (!prNumber) throw new Error("dispatch requires the PR number");
  if (!headSha) throw new Error("dispatch requires the expected head sha");
  return [
    "workflow",
    "run",
    workflow,
    ...(repo ? ["--repo", repo] : []),
    "--ref",
    branch,
    "-f",
    `pr_number=${prNumber}`,
    "-f",
    `expected_head_sha=${headSha}`,
  ];
}

function sh(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function parseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function fetchCiForHead(branch, headSha, repo) {
  if (!branch || !headSha) return null;
  const runs = parseJson(
    sh("gh", [
      "run",
      "list",
      ...(repo ? ["--repo", repo] : []),
      "--workflow",
      "validate.yml",
      "--branch",
      branch,
      "--limit",
      "20",
      "--json",
      "databaseId,headSha,status,conclusion",
    ]),
  );
  return Array.isArray(runs) ? runs.find((run) => run.headSha === headSha) ?? null : null;
}

function fetchReviewRuns(branch, repo) {
  if (!branch) return null;
  return parseJson(
    sh("gh", [
      "run",
      "list",
      ...(repo ? ["--repo", repo] : []),
      "--workflow",
      CLAUDE_REVIEW_WORKFLOW,
      "--branch",
      branch,
      "--limit",
      "20",
      "--json",
      "databaseId,headSha,status,conclusion",
    ]),
  );
}

function main() {
  const [, , prNumberRaw, ...rest] = process.argv;
  if (!prNumberRaw) {
    console.error("Usage: rick-loop-review-dispatch.mjs <pr-number> [--dry-run]");
    process.exit(1);
  }
  const dryRun = rest.includes("--dry-run");
  const prNumber = Number(prNumberRaw);

  const inputs = collectPreflightInputs(prNumber);
  const preflight = evaluatePreflight(inputs);
  const pr = inputs.pr;
  const ci = pr ? fetchCiForHead(pr.headRefName, pr.headRefOid, null) : null;
  const existingRuns = pr ? fetchReviewRuns(pr.headRefName, null) : null;

  const decision = evaluateDispatch({ pr, ci, preflight, existingRuns });
  const report = {
    pr: prNumber,
    ...decision,
    preflight_reasons: preflight.reasons,
    ci: ci ? { id: ci.databaseId, status: ci.status, conclusion: ci.conclusion, headSha: ci.headSha } : null,
    dry_run: dryRun,
  };

  if (!decision.dispatch || dryRun) {
    console.log(JSON.stringify({ ...report, dispatched: false }, null, 2));
    process.exitCode = decision.dispatch ? 0 : 2;
    return;
  }

  const args = buildDispatchArgs({
    branch: decision.branch,
    prNumber,
    headSha: decision.head,
  });
  const output = sh("gh", args);
  const dispatched = output !== null;
  console.log(JSON.stringify({ ...report, dispatched, gh_output: output }, null, 2));
  process.exitCode = dispatched ? 0 : 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
