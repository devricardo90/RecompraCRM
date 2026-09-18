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
  "roadmap_pointers_agree",
]);

/**
 * The same fact is written in three places - STATE.md, HANDOFF.md and the
 * matching ROADMAP entry - and eight separate review rounds across PRs 36, 37
 * and 38 caught it updated in two of the three. The last one was inside a
 * commit whose own message said all three had been swept. That is not a
 * discipline problem any longer; nothing mechanical was looking.
 *
 * Each entry maps a logical pointer to the field name used in each source.
 * ROADMAP entry fields are unprefixed because they already sit under their
 * entry heading.
 */
export const TRACKED_POINTERS = Object.freeze({
  "ARCH-04.impl_branch": { state: "arch_04_impl_branch", handoff: "arch_04_impl_branch", roadmap: "impl_branch", entry: "ARCH-04" },
  "ARCH-04.impl_stage": { state: "arch_04_impl_stage", handoff: "arch_04_impl_stage", roadmap: "impl_stage", entry: "ARCH-04" },
  "ARCH-04.next_action": { state: "next_action", handoff: "next_action", roadmap: "next_action", entry: "ARCH-04" },
});

/**
 * ROADMAP prose habitually appends an explanation after an em dash
 * ("VALUE — porque ..."), which is deliberate and should not count as drift.
 * Only the value token before it is compared.
 */
export function normalizePointerValue(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).split("—")[0].trim();
  return text === "" ? null : text;
}

/**
 * Reads the sub-fields of one `- [ ] <ID> — title` entry in ROADMAP.md.
 * parseRoadmapPlan deliberately models only depends_on/blocked_by/status/
 * blocking, so the fields this gate compares are invisible to it.
 */
export function readRoadmapEntryFields(text, entryId) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const fields = {};
  let inside = false;
  let checked = false;
  for (const line of lines) {
    const heading = line.match(/^- \[([ xX])\] ((?:TASK|ARCH)-\d+)\s+—/);
    if (heading) {
      if (inside) break;
      inside = heading[2] === entryId;
      if (inside) checked = heading[1].toLowerCase() === "x";
      continue;
    }
    if (!inside) continue;
    const meta = line.match(/^\s{2,}-\s+([a-zA-Z0-9_]+):\s*(.*)$/);
    if (meta) fields[meta[1]] = meta[2];
  }
  return { ...fields, __checked: checked, __found: inside || Object.keys(fields).length > 0 };
}

/**
 * A pointer is only compared where it is actually present: a value absent
 * everywhere is nothing to disagree about, and a value present in only one
 * source has nothing to disagree with. Two or more present and differing is
 * the drift this exists to catch.
 */
export function comparePointers({ state = null, handoff = null, roadmapText = null } = {}) {
  const mismatches = [];
  for (const [pointer, spec] of Object.entries(TRACKED_POINTERS)) {
    const roadmapFields = roadmapText === null ? null : readRoadmapEntryFields(roadmapText, spec.entry);
    // Once an entry is checked off, its fields are a historical record of how
    // that item finished, while STATE/HANDOFF have moved on to the next work.
    // Comparing the two then manufactures drift out of correct bookkeeping.
    if (roadmapFields?.__checked === true) continue;
    const values = {};
    const fromState = normalizePointerValue(state?.[spec.state]);
    const fromHandoff = normalizePointerValue(handoff?.[spec.handoff]);
    const fromRoadmap = normalizePointerValue(roadmapFields?.[spec.roadmap]);
    if (fromState !== null) values.state = fromState;
    if (fromHandoff !== null) values.handoff = fromHandoff;
    if (fromRoadmap !== null) values.roadmap = fromRoadmap;

    if (Object.keys(values).length < 2) continue;
    if (new Set(Object.values(values)).size > 1) mismatches.push({ pointer, values });
  }
  return mismatches;
}

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
  roadmapText = null,
  defaultBranch = "main",
} = {}) {
  const jsonl = validateJsonlLines(registerLines);
  const pointerMismatches = comparePointers({ state, handoff, roadmapText });
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
    roadmap_pointers_agree: pointerMismatches.length === 0,
  };

  const reasons = [];
  for (const name of PREFLIGHT_CHECKS) {
    if (checks[name] !== true) reasons.push(name);
  }
  if (!jsonl.valid && jsonl.invalidLine !== null) {
    reasons.push(`register_invalid_json_at_line_${jsonl.invalidLine}`);
  }
  // Named individually so the log says which pointer disagreed and what each
  // source claimed, rather than only that something did.
  for (const mismatch of pointerMismatches) {
    const detail = Object.entries(mismatch.values).map(([source, value]) => `${source}=${value}`).join(" ");
    reasons.push(`pointer_disagreement:${mismatch.pointer}(${detail})`);
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

  return { state, handoff, registerLines, drift, pr, git, roadmapText: readTextOrNull("docs/roadmap/ROADMAP.md") };
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
