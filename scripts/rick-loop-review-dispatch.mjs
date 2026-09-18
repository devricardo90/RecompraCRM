import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { collectPagedList, REST_PAGE_SIZE } from "./rick-loop-controller.mjs";
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
  "already_reviewed",
  "awaiting_redispatch_cooldown",
]);

/**
 * Deliberately shorter than the watcher's one-hour RERUN cooldown. A run that
 * completed without publishing anything is most often a stale dispatch that
 * skipped in seconds, and stalling a real review for an hour behind one would
 * be worse than the duplicate-dispatch risk this bounds.
 */
export const REDISPATCH_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * A dispatched run executes the default branch's workflow definition, so
 * GitHub records it against the default branch and its headSha is main's, not
 * the PR's. The workflow's run-name carries `PR #<n> @ <sha>` for exactly this
 * reason. headSha is still matched first because the additive `pull_request`
 * trigger is still live in Stage 2 and those runs are anchored normally.
 */
export function reviewRunMatchesHead(run, headSha) {
  if (!run || !headSha) return false;
  if (run.headSha === headSha) return true;
  return typeof run.displayTitle === "string" && run.displayTitle.includes(headSha);
}

export function findRunForHead(runs, headSha) {
  if (!Array.isArray(runs) || !headSha) return null;
  return runs.find((run) => reviewRunMatchesHead(run, headSha)) ?? null;
}

/**
 * Any published verdict for this exact HEAD, clean or findings - the same
 * `Reviewed commit: <sha>` anchor the merge gate parses. Used to tell a run
 * that actually reviewed this HEAD from one that merely got associated with
 * it.
 */
export function hasVerdictForHead(comments, headSha, { authorLogin = null } = {}) {
  if (!Array.isArray(comments) || !headSha) return false;
  return comments.some((entry) => {
    const login = entry?.user?.login ?? null;
    // Independence is required here for the same reason the merge gate
    // requires it in buildAnchoredResults: a verdict the PR's own author wrote
    // is not evidence anyone reviewed anything. Without this, posting
    // "Reviewed commit: <headSha>" on your own PR would convince the
    // dispatcher that HEAD is already reviewed and permanently stop it from
    // dispatching a real one - the merge gate would still refuse to merge, so
    // nothing unsafe lands, but the loop stalls silently, which is exactly the
    // deterministic-dispatch invariant this task exists to establish.
    // An unknown author or unknown PR author fails closed: unproven
    // independence costs at most an extra review, while trusting it costs the
    // loop its liveness.
    if (!login || !authorLogin || login === authorLogin) return false;
    const named = String(entry?.body ?? "").match(/reviewed commit:[^0-9a-zA-Z]{0,8}([0-9a-f]{7,40})/i);
    return named ? headSha.startsWith(named[1]) : false;
  });
}

/**
 * `gh workflow run --ref <branch>` resolves the branch tip at dispatch time,
 * so a push landing between the dispatcher reading the HEAD and GitHub
 * accepting the dispatch produces a run associated with the NEW head while
 * carrying the OLD head as expected_head_sha. The workflow correctly refuses
 * to review the stale commit and skips - but that skipped run is still
 * associated with the new head. Keying idempotency on the run's existence
 * alone would let it reserve a HEAD it never reviewed, and because rerunning
 * replays the same stale input, that HEAD could never get a review at all.
 * A run therefore only reserves a HEAD while it is in flight, once it has
 * published a verdict for that HEAD, or briefly after completing.
 */
export function classifyExistingRun(run, { verdictPublished = false, now = new Date(), cooldownMs = REDISPATCH_COOLDOWN_MS } = {}) {
  // Checked before the run itself: `gh run list --limit 20` is a window, and
  // the run that produced a verdict ages out of it on a PR several rounds
  // deep. Asking about the run first would then report NONE for a HEAD that
  // demonstrably has a verdict and re-review it - the exact waste this task
  // exists to remove. A published verdict settles the HEAD whether or not the
  // run that produced it is still listed.
  if (verdictPublished) return "REVIEWED";
  if (!run) return "NONE";
  if (["queued", "in_progress", "waiting", "pending"].includes(run.status)) return "IN_FLIGHT";
  if (run.status !== "completed") return "IN_FLIGHT";
  const finishedAt = Date.parse(run.updatedAt ?? run.createdAt ?? "");
  // An unreadable timestamp is unknown age, so it waits rather than
  // re-dispatching immediately.
  if (!Number.isFinite(finishedAt)) return "COOLING_DOWN";
  return now.getTime() - finishedAt < cooldownMs ? "COOLING_DOWN" : "STALE_NO_VERDICT";
}

export function evaluateDispatch({
  pr = null,
  ci = null,
  preflight = null,
  existingRuns = null,
  comments = null,
  now = new Date(),
  cooldownMs = REDISPATCH_COOLDOWN_MS,
} = {}) {
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
  let runState = "UNKNOWN";
  if (!Array.isArray(existingRuns)) {
    blockers.push("already_dispatched");
  } else {
    const run = findRunForHead(existingRuns, pr?.headRefOid);
    runState = classifyExistingRun(run, {
      verdictPublished: hasVerdictForHead(comments, pr?.headRefOid, { authorLogin: pr?.author?.login ?? null }),
      now,
      cooldownMs,
    });
    if (runState === "IN_FLIGHT") blockers.push("already_dispatched");
    else if (runState === "REVIEWED") blockers.push("already_reviewed");
    else if (runState === "COOLING_DOWN") blockers.push("awaiting_redispatch_cooldown");
    // NONE and STALE_NO_VERDICT both mean this HEAD has no review and none is
    // coming without a fresh dispatch.
  }

  return {
    dispatch: blockers.length === 0,
    blockers,
    run_state: runState,
    head: pr?.headRefOid ?? null,
    branch: pr?.headRefName ?? null,
  };
}

/**
 * --ref names the branch whose *version of the workflow file* runs, not just
 * the code under review. Passing the PR branch would therefore execute the
 * PR author's own copy of claude-pr-review.yml, with this job's
 * CLAUDE_CODE_OAUTH_TOKEN and its pull-requests/issues write scopes - and
 * every validation step in that file is part of what the author can rewrite,
 * so the checks could simply be deleted. Anyone able to push a same-repo
 * branch would escalate to reading the review token.
 *
 * So the dispatch always runs the default branch's definition, which no PR can
 * modify, and the PR's HEAD travels as an input that the trusted workflow
 * checks out after revalidating it. Found by independent review on PR 40
 * (P1); the earlier design documented here justified --ref <PR branch> purely
 * by run correlation, which reviewRunMatchesHead now solves without handing
 * the workflow definition to the author.
 */
export function buildDispatchArgs({ workflow = CLAUDE_REVIEW_WORKFLOW, defaultBranch, prNumber, headSha, repo = null }) {
  if (!defaultBranch) throw new Error("dispatch requires the default branch for --ref");
  if (!prNumber) throw new Error("dispatch requires the PR number");
  if (!headSha) throw new Error("dispatch requires the expected head sha");
  return [
    "workflow",
    "run",
    workflow,
    ...(repo ? ["--repo", repo] : []),
    "--ref",
    defaultBranch,
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

/**
 * Deliberately not filtered by --branch any more: a dispatched run is recorded
 * against the default branch, so filtering by the PR branch would hide exactly
 * the runs this dispatcher creates and it would re-dispatch every cycle.
 * displayTitle is requested because reviewRunMatchesHead needs it.
 */
function fetchReviewRuns(repo) {
  return parseJson(
    sh("gh", [
      "run",
      "list",
      ...(repo ? ["--repo", repo] : []),
      "--workflow",
      CLAUDE_REVIEW_WORKFLOW,
      "--limit",
      "20",
      "--json",
      "databaseId,headSha,displayTitle,status,conclusion",
    ]),
  );
}

/**
 * GitHub returns issue comments oldest-first, so a single unpaginated page
 * silently drops the newest ones - exactly where a verdict for the current
 * HEAD lives on a long-running PR. Missing it would report "no verdict" for a
 * HEAD that was in fact reviewed and re-dispatch for nothing, which is the
 * wasted invocation this task exists to remove. collectPagedList is the same
 * primitive the merge gate already uses for this endpoint, and it returns null
 * rather than a partial list when a walk cannot be completed.
 */
export function fetchIssueComments(prNumber, { repo = null } = {}) {
  const repoPath = repo ?? "{owner}/{repo}";
  return collectPagedList((page) =>
    parseJson(sh("gh", ["api", `repos/${repoPath}/issues/${prNumber}/comments?per_page=${REST_PAGE_SIZE}&page=${page}`])),
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
  const existingRuns = pr ? fetchReviewRuns(null) : null;
  const comments = fetchIssueComments(prNumber);

  const decision = evaluateDispatch({ pr, ci, preflight, existingRuns, comments });
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

  // The PR's base branch is the repository default here (preflight's
  // pr_base_is_default already refused to dispatch otherwise), so it is the
  // trusted ref whose workflow definition runs.
  const args = buildDispatchArgs({
    defaultBranch: pr.baseRefName,
    prNumber,
    headSha: decision.head,
  });
  const output = sh("gh", args);
  const dispatched = output !== null;
  console.log(JSON.stringify({ ...report, dispatched, gh_output: output }, null, 2));
  process.exitCode = dispatched ? 0 : 3;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
