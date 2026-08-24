import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export const VALIDATION_SCHEMA_VERSION = "1.0";
export const DEFAULT_INPUT_PATH = ".rick/tmp/validation-input.json";
export const DEFAULT_RESULT_PATH = ".rick/tmp/validation.json";
export const DEFAULT_REPORT_PATH = ".rick/tmp/validation.md";

const REQUIRED_FAST_GATES = Object.freeze(["lint", "typecheck", "unit", "integration", "build"]);
const CRITICAL_PATH_PATTERNS = Object.freeze([
  /(^|\/)scripts\/rick-loop-/i,
  /(^|\/)app\/api\//i,
  /(^|\/)middleware\./i,
  /(^|\/)(auth|security|permissions?|finance|financial|billing|payments?)(\/|\.|-)/i,
  /(^|\/)lib\/.*(domain|date|time|timezone|transaction|forecast|state|permission|security|auth)/i,
  /(^|\/)prisma\/migrations\//i,
]);

function sh(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

export function sha256(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

export function normalizeAcId(value) {
  const match = String(value ?? "").match(/^AC[-_ ]?(\d{1,3})$/i);
  if (!match) return null;
  return `AC-${String(Number(match[1])).padStart(2, "0")}`;
}

function sectionByHeading(text, headingPattern) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  let start = -1;
  let level = null;
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{1,6})\s+(.+)$/);
    if (!heading) continue;
    if (headingPattern.test(heading[2].trim())) {
      start = index + 1;
      level = heading[1].length;
      break;
    }
  }
  if (start === -1) return "";
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{1,6})\s+/);
    if (heading && heading[1].length <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

export function acceptanceCriteriaSection(specText) {
  return sectionByHeading(specText, /^(?:crit[eé]rios\s+de\s+(?:aceite|aceita[cç][aã]o)|acceptance\s+criteria)$/i);
}

export function definitionOfDoneSection(specText) {
  return sectionByHeading(specText, /^(?:definition\s+of\s+done|defini[cç][aã]o\s+de\s+pronto)$/i);
}

export function analyzeAcceptanceCriteria(specText) {
  const section = acceptanceCriteriaSection(specText);
  const raw = [];
  const linePattern = /^\s*(?:[-*]\s+|#{1,6}\s+|\*\*)?(AC[-_ ]?\d{1,3})\b/gim;
  let match;
  while ((match = linePattern.exec(section)) !== null) {
    const id = normalizeAcId(match[1]);
    if (id) raw.push(id);
  }
  const counts = new Map();
  for (const id of raw) counts.set(id, (counts.get(id) ?? 0) + 1);
  const ids = [...counts.keys()].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
  const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  const numbers = ids.map((id) => Number(id.slice(3)));
  const sequenceGaps = [];
  if (numbers.length > 0) {
    for (let value = numbers[0]; value <= numbers.at(-1); value += 1) {
      if (!numbers.includes(value)) sequenceGaps.push(`AC-${String(value).padStart(2, "0")}`);
    }
  }
  return { section_present: Boolean(section.trim()), ids, duplicates, sequence_gaps: sequenceGaps };
}

function acLabel(value) {
  return `AC-${String(value).padStart(2, "0")}`;
}

// A Definition of Done may legitimately state its coverage as several ranges, so each range
// is only a claim; what matters is whether their union proves exactly the spec's AC set.
// Judging ranges one at a time flagged "AC1 a AC10 ... AC11 a AC22" as stale purely because
// the first range did not end at the last AC.
export function analyzeDodAcCoverage(specText, acIds) {
  const section = definitionOfDoneSection(specText);
  if (!section.trim() || !Array.isArray(acIds) || acIds.length === 0) return { section_present: Boolean(section.trim()), ranges: [], gaps: [] };
  const required = [...new Set(acIds.map((id) => Number(id.slice(3))))].sort((a, b) => a - b);
  const ranges = [];
  const pattern = /AC[-_ ]?(\d{1,3})\s*(?:a|at[eé]|through|-)\s*(?:AC[-_ ]?)?(\d{1,3})\s+provad/gi;
  let match;
  while ((match = pattern.exec(section)) !== null) {
    ranges.push({ first: Number(match[1]), last: Number(match[2]) });
  }
  // No range statement at all is not a coverage claim, so there is nothing to contradict.
  if (ranges.length === 0) return { section_present: true, ranges, gaps: [] };

  const gaps = [];
  const covered = new Set();
  for (const range of ranges) {
    // A reversed or malformed range proves nothing and must never be read as coverage.
    if (!Number.isInteger(range.first) || !Number.isInteger(range.last) || range.last < range.first) {
      gaps.push(`DOD_AC_RANGE_INVALID_${acLabel(range.first)}_${acLabel(range.last)}`);
      continue;
    }
    for (let value = range.first; value <= range.last; value += 1) covered.add(value);
  }

  // Claiming an AC the spec does not define means the DoD and the spec disagree about what
  // exists, which is a spec-precision gap rather than proof.
  for (const value of [...covered].sort((a, b) => a - b)) {
    if (!required.includes(value)) gaps.push(`DOD_AC_RANGE_OUT_OF_SPEC_${acLabel(value)}`);
  }
  // Overlapping ranges are harmless; an uncovered AC is not.
  for (const value of required) {
    if (!covered.has(value)) gaps.push(`DOD_AC_COVERAGE_GAP_${acLabel(value)}`);
  }
  return { section_present: true, ranges, gaps };
}

export function isCriticalPath(path) {
  return CRITICAL_PATH_PATTERNS.some((pattern) => pattern.test(String(path ?? "")));
}

export function sensorApplicable(changedFiles = []) {
  return Array.isArray(changedFiles) && changedFiles.some(isCriticalPath);
}

function evidencePresent(entry) {
  return Array.isArray(entry?.evidence) && entry.evidence.length > 0 && entry.evidence.every((item) => {
    if (typeof item === "string") return item.trim().length > 0;
    return Boolean(item && typeof item === "object" && Object.keys(item).length > 0);
  });
}

function groupResult(entries, name) {
  const list = Array.isArray(entries) ? entries : [];
  const failed = list.filter((entry) => entry?.status !== "PROVED" || !evidencePresent(entry));
  return { name, total: list.length, proved: list.length - failed.length, failed, pass: list.length > 0 && failed.length === 0 };
}

export function evaluateValidation(manifest, context) {
  const failures = [];
  const spec = analyzeAcceptanceCriteria(context?.specText ?? "");
  const dod = analyzeDodAcCoverage(context?.specText ?? "", spec.ids);
  if (!spec.section_present) failures.push({ code: "SPEC_AC_SECTION_MISSING", message: "Acceptance Criteria section is missing or not machine-addressable" });
  if (spec.ids.length === 0) failures.push({ code: "SPEC_AC_IDS_MISSING", message: "No explicit AC ids were found in the Acceptance Criteria section" });
  if (spec.duplicates.length > 0) failures.push({ code: "SPEC_AC_DUPLICATE", ids: spec.duplicates });
  if (spec.sequence_gaps.length > 0) failures.push({ code: "SPEC_AC_SEQUENCE_GAP", ids: spec.sequence_gaps });
  if (dod.gaps.length > 0) failures.push({ code: "SPEC_DOD_AC_RANGE_STALE", gaps: dod.gaps });

  const expectedSpecDigest = sha256(context?.specText ?? "");
  if (manifest?.schema_version !== VALIDATION_SCHEMA_VERSION) failures.push({ code: "VALIDATION_SCHEMA_MISMATCH" });
  if (!manifest?.task || manifest.task !== context?.task) failures.push({ code: "TASK_IDENTITY_MISMATCH" });
  if (!manifest?.head_sha || manifest.head_sha !== context?.currentHead) failures.push({ code: "HEAD_IDENTITY_MISMATCH" });
  if (!manifest?.base_sha || manifest.base_sha !== context?.baseSha) failures.push({ code: "BASE_IDENTITY_MISMATCH" });
  if (context?.baseAncestor !== true) failures.push({ code: "BASE_NOT_ANCESTOR_OF_HEAD" });
  if (manifest?.spec_sha256 !== expectedSpecDigest) failures.push({ code: "SPEC_DIGEST_MISMATCH" });
  if (manifest?.validator?.role !== "INDEPENDENT_VALIDATOR" || manifest?.validator?.context !== "fork") {
    failures.push({ code: "VALIDATOR_NOT_INDEPENDENT", message: "validation must be produced by the forked independent validator role" });
  }

  const proofById = new Map();
  for (const entry of Array.isArray(manifest?.acceptance_criteria) ? manifest.acceptance_criteria : []) {
    const id = normalizeAcId(entry?.id);
    if (!id) continue;
    if (!proofById.has(id)) proofById.set(id, []);
    proofById.get(id).push(entry);
  }
  const acGaps = [];
  let acProved = 0;
  for (const id of spec.ids) {
    const candidates = proofById.get(id) ?? [];
    const proved = candidates.length === 1 && candidates[0]?.status === "PROVED" && evidencePresent(candidates[0]);
    if (proved) acProved += 1;
    else acGaps.push(id);
  }
  const extraAc = [...proofById.keys()].filter((id) => !spec.ids.includes(id));
  const duplicateProofs = [...proofById.entries()].filter(([, entries]) => entries.length !== 1).map(([id]) => id);
  if (acGaps.length > 0) failures.push({ code: "AC_PROOF_GAP", ids: acGaps });
  if (extraAc.length > 0) failures.push({ code: "AC_PROOF_NOT_IN_SPEC", ids: extraAc });
  if (duplicateProofs.length > 0) failures.push({ code: "AC_PROOF_CARDINALITY", ids: duplicateProofs });

  const gates = {};
  for (const gate of REQUIRED_FAST_GATES) {
    const value = String(manifest?.fast_gates?.[gate] ?? "MISSING").toUpperCase();
    gates[gate] = value;
    if (value !== "PASS") failures.push({ code: "FAST_GATE_NOT_PASS", gate, value });
  }

  const expectedBehavior = groupResult(manifest?.expected_behavior, "expected_behavior");
  const negativeBehavior = groupResult(manifest?.negative_behavior, "negative_behavior");
  const edgeCases = groupResult(manifest?.edge_cases, "edge_cases");
  for (const group of [expectedBehavior, negativeBehavior, edgeCases]) {
    if (!group.pass) failures.push({ code: "BEHAVIOR_PROOF_GAP", group: group.name, failed: group.failed.length, total: group.total });
  }

  const freshChecks = Array.isArray(manifest?.fresh_execution) ? manifest.fresh_execution : [];
  const freshPass = freshChecks.length > 0 && freshChecks.every((entry) => entry?.status === "PASS" && entry?.cache_bypassed === true);
  if (!freshPass) failures.push({ code: "FRESH_EXECUTION_NOT_PROVED", message: "authoritative validation requires fresh non-cache-only proof" });

  const critical = sensorApplicable(context?.changedFiles ?? []);
  const sensor = manifest?.sensor ?? {};
  let sensorPass = true;
  if (critical) {
    const injected = Number(sensor.injected ?? 0);
    const killed = Number(sensor.killed ?? 0);
    const survived = Number(sensor.survived ?? 0);
    sensorPass = sensor.applicable === true && Number.isInteger(injected) && injected > 0 && killed === injected && survived === 0;
    if (!sensorPass) failures.push({ code: "ROBUSTNESS_SENSOR_FAILED", injected, killed, survived });
  } else if (sensor.applicable === true) {
    const injected = Number(sensor.injected ?? 0);
    const killed = Number(sensor.killed ?? 0);
    const survived = Number(sensor.survived ?? 0);
    sensorPass = Number.isInteger(injected) && injected > 0 && killed === injected && survived === 0;
    if (!sensorPass) failures.push({ code: "ROBUSTNESS_SENSOR_FAILED", injected, killed, survived });
  }

  const specPrecisionGaps = [...spec.duplicates, ...spec.sequence_gaps, ...dod.gaps];
  const result = failures.length === 0 ? "PASS" : "FAIL";
  return {
    schema_version: VALIDATION_SCHEMA_VERSION,
    phase: "AUTHORITATIVE_VALIDATION",
    task: context?.task ?? null,
    base_sha: context?.baseSha ?? null,
    head_sha: context?.currentHead ?? null,
    spec_path: context?.specPath ?? null,
    spec_sha256: expectedSpecDigest,
    spec_anchored_check: {
      total: spec.ids.length,
      proved: acProved,
      gaps: acGaps,
      spec_precision_gaps: specPrecisionGaps,
      extra_proofs: extraAc,
      dod_ranges: dod.ranges,
    },
    gates,
    behavior: { expected: expectedBehavior, negative: negativeBehavior, edge_cases: edgeCases },
    fresh_execution: { pass: freshPass, checks: freshChecks.length },
    sensor: {
      required: critical,
      applicable: sensor.applicable === true,
      injected: Number(sensor.injected ?? 0),
      killed: Number(sensor.killed ?? 0),
      survived: Number(sensor.survived ?? 0),
      pass: sensorPass,
    },
    failures,
    result,
  };
}

function writeResult(result, resultPath = DEFAULT_RESULT_PATH, reportPath = DEFAULT_REPORT_PATH) {
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  const lines = [
    `# Validation: ${result.phase} — ${result.result}`,
    "",
    `Task: ${result.task}`,
    `HEAD: ${result.head_sha}`,
    `Spec: ${result.spec_path}`,
    "",
    `Spec-anchored check: ${result.spec_anchored_check.proved}/${result.spec_anchored_check.total} ACs proved`,
    `AC gaps: ${result.spec_anchored_check.gaps.length}`,
    `Spec-precision gaps: ${result.spec_anchored_check.spec_precision_gaps.length}`,
    "",
    `Sensor: ${result.sensor.injected} injected / ${result.sensor.killed} killed / ${result.sensor.survived} survived${result.sensor.required ? " (required)" : ""}`,
    "",
    result.failures.length ? "## Failures" : "## Gate",
    ...(result.failures.length ? result.failures.map((failure) => `- ${failure.code}${failure.ids ? `: ${failure.ids.join(", ")}` : failure.gaps ? `: ${failure.gaps.join(", ")}` : ""}`) : ["PASS"]),
    "",
  ];
  writeFileSync(reportPath, lines.join("\n"), "utf8");
}

function deriveBaseline(currentHead) {
  for (const ref of ["origin/main", "main"]) {
    try {
      execFileSync("git", ["rev-parse", "--verify", ref], { stdio: "ignore" });
      return sh("git", ["merge-base", ref, currentHead]);
    } catch {
      // try the next candidate ref
    }
  }
  return null;
}

function cli() {
  const inputPath = process.argv[2] ?? DEFAULT_INPUT_PATH;
  if (!existsSync(inputPath)) {
    console.error(`Validation input not found: ${inputPath}`);
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(inputPath, "utf8"));
  const task = manifest.task;
  const specPath = manifest.spec_path ?? `docs/specs/${task}.md`;
  if (!task || !existsSync(specPath)) {
    console.error(`Spec not found for validation: ${specPath}`);
    process.exit(2);
  }
  const currentHead = sh("git", ["rev-parse", "HEAD"]);
  // Derived from Git, never copied from the manifest. Taking base_sha from the manifest made
  // BASE_IDENTITY_MISMATCH compare the manifest against itself, so a manifest naming HEAD as
  // its own base produced an empty diff, disabled critical-path sensing, and could emit PASS
  // without validating any of the PR's changes.
  const baseSha = deriveBaseline(currentHead);
  let baseAncestor = false;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", baseSha, currentHead], { stdio: "ignore" });
    baseAncestor = true;
  } catch {
    baseAncestor = false;
  }
  let changedFiles = [];
  try {
    changedFiles = sh("git", ["diff", "--name-only", baseSha, currentHead]).split("\n").filter(Boolean);
  } catch {
    changedFiles = [];
  }
  const specText = readFileSync(specPath, "utf8");
  const result = evaluateValidation(manifest, { task, baseSha, currentHead, baseAncestor, specPath, specText, changedFiles });
  writeResult(result);
  console.log(JSON.stringify(result, null, 2));
  if (result.result !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) cli();
