import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const LOOP_VERSION = "RICK_LOOP_V1_4";
export const VALIDATION_PATH = ".rick/tmp/validation.json";
const RETRYABLE_WAITS = new Set(["WAIT_FOR_CI", "WAIT_FOR_CODEX", "EXTERNAL_RETRYABLE"]);
const VALIDATION_GATED_TRANSITIONS = new Set(["WAIT_FOR_CODEX", "READY_TO_MERGE"]);
const DOCS_ONLY_ALLOWLIST = /^docs\/(operations\/(STATE|HANDOFF)\.md|operations\/LOOP-REGISTER\.jsonl|operations\/LESSONS\.md|operations\/RICK-LOOP-V[\d.]+(?:-AMENDMENT)?\.md|roadmap\/ROADMAP\.md|evidence\/.*|specs\/TASK-\d+\.md)$/;

function sh(command, args) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function digest(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

function loadJson(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

export function isDocsOnly(files) {
  return Array.isArray(files) && files.length > 0 && files.every((file) => DOCS_ONLY_ALLOWLIST.test(file));
}

export function validationMatches(validation, { task, head, specDigest }) {
  return Boolean(
    validation
    && validation.result === "PASS"
    && validation.phase === "AUTHORITATIVE_VALIDATION"
    && validation.task === task
    && validation.head_sha === head
    && validation.spec_sha256 === specDigest,
  );
}

export function resolveV14Decision(raw, { validation = null, changedFiles = [], specDigest = null } = {}) {
  const original = raw?.decision ?? { transition: "HUMAN_REQUIRED", terminal: true, reason: "raw controller produced no decision" };
  const waited = original.waited_transition ?? original.transition;

  if (original.transition === "BLOCKED_EXTERNAL" && RETRYABLE_WAITS.has(original.waited_transition)) {
    return {
      transition: "PARKED_EXTERNAL_RETRYABLE",
      waited_transition: original.waited_transition,
      terminal: false,
      human_required: false,
      reason: "retryable external dependency exceeded the active poll budget; cadence slows but controller ownership is retained",
      evidence: original.evidence ?? null,
      pr_number: original.pr_number ?? raw?.pr?.number ?? null,
      pr_context: original.pr_context ?? null,
    };
  }

  if (RETRYABLE_WAITS.has(original.transition)) {
    return {
      ...original,
      transition: "PARKED_EXTERNAL_RETRYABLE",
      waited_transition: waited,
      terminal: false,
      human_required: false,
    };
  }

  const task = raw?.state_summary?.resolved_task ?? original.task ?? raw?.state_summary?.current_task ?? null;
  const head = raw?.pr?.headRefOid ?? raw?.git?.head ?? null;
  const docsOnly = isDocsOnly(changedFiles);
  const taskPr = Boolean(raw?.pr && original.pr_context !== "GOVERNANCE_PR" && task && raw?.task_spec?.present && !docsOnly);
  const exactHeadCiGreen = Boolean(raw?.ci && head && raw.ci.headSha === head && raw.ci.status === "completed" && raw.ci.conclusion === "success");

  if (taskPr && exactHeadCiGreen && VALIDATION_GATED_TRANSITIONS.has(original.transition)) {
    if (!validationMatches(validation, { task, head, specDigest })) {
      const matchingFailed = Boolean(validation && validation.task === task && validation.head_sha === head && validation.spec_sha256 === specDigest && validation.result === "FAIL");
      return {
        transition: matchingFailed ? "VALIDATION_FAILED" : "READY_FOR_VALIDATION",
        terminal: false,
        task,
        pr_number: raw.pr.number,
        pr_context: original.pr_context ?? "TASK_PR",
        head,
        reason: matchingFailed
          ? "authoritative validation failed for the exact current HEAD; fix gaps and validate again before review"
          : "fast gates are green, but no authoritative VALIDATION_PASS is bound to the exact current HEAD and spec",
        validation_required: true,
      };
    }
  }

  return original;
}

function diffBaseRef() {
  for (const candidate of ["origin/main", "main"]) {
    try {
      sh("git", ["rev-parse", "--verify", candidate]);
      return candidate;
    } catch {
      // try next deterministic base candidate
    }
  }
  return "main";
}

function changedFilesAgainstMain() {
  try {
    const base = sh("git", ["merge-base", diffBaseRef(), "HEAD"]);
    const output = sh("git", ["diff", "--name-only", base, "HEAD"]);
    return output ? output.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

function runRawController() {
  return JSON.parse(sh(process.execPath, ["scripts/rick-loop-controller.mjs"]));
}

function main() {
  const raw = runRawController();
  const changedFiles = raw?.pr ? changedFilesAgainstMain() : [];
  const validation = loadJson(VALIDATION_PATH);
  const task = raw?.state_summary?.resolved_task ?? raw?.decision?.task ?? raw?.state_summary?.current_task ?? null;
  const specPath = task ? `docs/specs/${task}.md` : null;
  const specDigest = specPath && existsSync(specPath) ? digest(readFileSync(specPath, "utf8")) : null;
  const decision = resolveV14Decision(raw, { validation, changedFiles, specDigest });
  const terminal = decision.terminal === true;
  console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    loop_version: LOOP_VERSION,
    authority: "rick-loop-supervisor",
    decision,
    validation: validation ? {
      task: validation.task ?? null,
      head_sha: validation.head_sha ?? null,
      result: validation.result ?? null,
      matches_current: validationMatches(validation, { task, head: raw?.pr?.headRefOid ?? raw?.git?.head ?? null, specDigest }),
      path: VALIDATION_PATH,
    } : { result: "MISSING", matches_current: false, path: VALIDATION_PATH },
    changed_files: changedFiles,
    docs_only: isDocsOnly(changedFiles),
    must_reenter: !terminal,
    controller: raw,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
