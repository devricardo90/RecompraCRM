import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { detectStateDrift, parseFlatYaml } from "./rick-loop-controller.mjs";

/**
 * ARCH-04: the deterministic, no-LLM checks that must pass before a review is
 * dispatched. Every check fails closed — a check that cannot be evaluated is a
 * failure, never a silent pass — matching how evaluateMergeAllowed already
 * treats unknown evidence.
 */

export const PREFLIGHT_CHECKS = Object.freeze([
  "state_parseable",
  "handoff_parseable",
  "register_valid_jsonl",
  "no_state_drift",
  "pr_open",
  "pr_not_draft",
  "pr_base_is_default",
  "pr_not_conflicting",
]);

function isNonEmptyRecord(value) {
  return Boolean(value) && typeof value === "object" && Object.keys(value).length > 0;
}

export function validateJsonlLines(lines) {
  if (!Array.isArray(lines)) return { valid: false, invalidLine: null };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (typeof line !== "string" || line.trim() === "") continue;
    try {
      JSON.parse(line);
    } catch {
      return { valid: false, invalidLine: index + 1 };
    }
  }
  return { valid: true, invalidLine: null };
}

/**
 * `drift` is the output of detectStateDrift; `null` means it could not be
 * computed, which fails rather than passes.
 */
export function evaluatePreflight({
  state = null,
  handoff = null,
  registerLines = null,
  drift = null,
  pr = null,
  defaultBranch = "main",
} = {}) {
  const jsonl = validateJsonlLines(registerLines);
  const checks = {
    state_parseable: isNonEmptyRecord(state),
    handoff_parseable: isNonEmptyRecord(handoff),
    register_valid_jsonl: Array.isArray(registerLines) && jsonl.valid,
    no_state_drift: Array.isArray(drift) && drift.length === 0,
    pr_open: pr?.state === "OPEN",
    pr_not_draft: pr ? pr.isDraft === false : false,
    pr_base_is_default: pr ? pr.baseRefName === defaultBranch : false,
    // CONFLICTING is the only value that proves a conflict; UNKNOWN means
    // GitHub has not finished computing mergeability, which is not proof of
    // anything and must not pass a gate that exists to be deterministic.
    pr_not_conflicting: pr ? pr.mergeable === "MERGEABLE" : false,
  };

  const reasons = [];
  for (const name of PREFLIGHT_CHECKS) {
    if (checks[name] !== true) reasons.push(name);
  }
  if (!jsonl.valid && jsonl.invalidLine !== null) {
    reasons.push(`register_invalid_json_at_line_${jsonl.invalidLine}`);
  }

  return { pass: reasons.length === 0, checks, reasons };
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

function readTextOrNull(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

export function collectPreflightInputs(prNumber, { repo = null } = {}) {
  const stateText = readTextOrNull("docs/operations/STATE.md");
  const handoffText = readTextOrNull("docs/operations/HANDOFF.md");
  const registerText = readTextOrNull("docs/operations/LOOP-REGISTER.jsonl");
  const state = stateText ? parseFlatYaml(stateText) : null;
  const handoff = handoffText ? parseFlatYaml(handoffText) : null;
  const registerLines = registerText === null ? null : registerText.replace(/\r\n/g, "\n").split("\n");

  const repoArgs = repo ? ["--repo", repo] : [];
  const pr = parseJson(
    sh("gh", [
      "pr",
      "view",
      String(prNumber),
      ...repoArgs,
      "--json",
      "number,state,isDraft,baseRefName,headRefName,headRefOid,mergeable,author",
    ]),
  );

  const branch = sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const head = sh("git", ["rev-parse", "HEAD"]);
  const dirty = (sh("git", ["status", "--porcelain"]) || "").length > 0;
  const git = { branch, head, dirty };

  // detectStateDrift needs the PR shaped the way the controller supplies it.
  const drift = state
    ? detectStateDrift({
        state,
        handoff,
        git,
        pr: pr ? { ...pr, headRefName: pr.headRefName, headRefOid: pr.headRefOid } : null,
      })
    : null;

  return { state, handoff, registerLines, drift, pr, git };
}

function main() {
  const [, , prNumberRaw] = process.argv;
  if (!prNumberRaw) {
    console.error("Usage: rick-loop-preflight.mjs <pr-number>");
    process.exit(1);
  }

  const inputs = collectPreflightInputs(prNumberRaw);
  const result = evaluatePreflight(inputs);
  console.log(JSON.stringify({ pr: Number(prNumberRaw), ...result }, null, 2));
  process.exitCode = result.pass ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
