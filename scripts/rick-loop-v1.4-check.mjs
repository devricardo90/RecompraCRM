import assert from "node:assert/strict";
import { analyzeAcceptanceCriteria, analyzeDodAcCoverage, evaluateValidation, sha256 } from "./rick-loop-validation.mjs";
import { resolveV14Decision, validationMatches } from "./rick-loop-supervisor.mjs";
import { retryDelaySeconds } from "./rick-loop-watcher.mjs";
import { deriveStats } from "./rick-loop-stats.mjs";

const spec = `# TASK-99\n\n## Critérios de aceite\n\nAC1. first\nAC2. second\nAC3. third\n\n## Definition of Done\n\n- AC1 a AC3 provados por teste.\n`;
const baseContext = {
  task: "TASK-99",
  baseSha: "base123",
  currentHead: "head123",
  baseAncestor: true,
  specPath: "docs/specs/TASK-99.md",
  specText: spec,
  changedFiles: ["app/api/example/route.ts"],
};
const proof = (id) => ({ id, status: "PROVED", evidence: [`test:${id}`] });
const manifest = {
  schema_version: "1.0",
  task: "TASK-99",
  base_sha: "base123",
  head_sha: "head123",
  spec_path: "docs/specs/TASK-99.md",
  spec_sha256: sha256(spec),
  validator: { role: "INDEPENDENT_VALIDATOR", context: "fork" },
  acceptance_criteria: [proof("AC-01"), proof("AC-02"), proof("AC-03")],
  fast_gates: { lint: "PASS", typecheck: "PASS", unit: "PASS", integration: "PASS", build: "PASS" },
  expected_behavior: [{ status: "PROVED", evidence: ["expected:test"] }],
  negative_behavior: [{ status: "PROVED", evidence: ["negative:test"] }],
  edge_cases: [{ status: "PROVED", evidence: ["edge:test"] }],
  fresh_execution: [{ status: "PASS", cache_bypassed: true, evidence: "fresh:test" }],
  sensor: { applicable: true, injected: 2, killed: 2, survived: 0 },
};

const ac = analyzeAcceptanceCriteria(spec);
assert.deepEqual(ac.ids, ["AC-01", "AC-02", "AC-03"], "Critérios de aceite and compact AC1 syntax must be machine readable");
assert.deepEqual(analyzeDodAcCoverage(spec, ac.ids).gaps, []);
assert.equal(evaluateValidation(manifest, baseContext).result, "PASS", "complete AC proof and killed sensor must pass");

const missingAc = { ...manifest, acceptance_criteria: [proof("AC-01"), proof("AC-02")] };
const missingResult = evaluateValidation(missingAc, baseContext);
assert.equal(missingResult.result, "FAIL");
assert.deepEqual(missingResult.spec_anchored_check.gaps, ["AC-03"], "2/3 or 23/24 is a hard validation failure");

const staleDodSpec = spec.replace("AC1 a AC3 provados", "AC1 a AC2 provados");
const staleDodManifest = { ...manifest, spec_sha256: sha256(staleDodSpec) };
const staleDodResult = evaluateValidation(staleDodManifest, { ...baseContext, specText: staleDodSpec });
assert.equal(staleDodResult.result, "FAIL", "a stale DoD AC range must be a spec-precision failure");
assert.equal(staleDodResult.failures.some((entry) => entry.code === "SPEC_DOD_AC_RANGE_STALE"), true);

const survivor = { ...manifest, sensor: { applicable: true, injected: 2, killed: 1, survived: 1 } };
assert.equal(evaluateValidation(survivor, baseContext).result, "FAIL", "a surviving injected fault must fail validation");

const wrongHead = { ...manifest, head_sha: "other" };
assert.equal(evaluateValidation(wrongHead, baseContext).result, "FAIL", "validation evidence is exact-head bound");

const needsValidationRaw = {
  decision: { transition: "WAIT_FOR_CODEX", terminal: false, pr_context: "TASK_PR" },
  pr: { number: 26, headRefOid: "head123" },
  git: { head: "head123" },
  state_summary: { resolved_task: "TASK-99" },
  task_spec: { present: true },
  ci: { headSha: "head123", status: "completed", conclusion: "success" },
};
const needsValidation = resolveV14Decision(needsValidationRaw, { validation: null, changedFiles: ["app/page.tsx"], specDigest: manifest.spec_sha256 });
assert.equal(needsValidation.transition, "READY_FOR_VALIDATION", "green tests cannot jump directly to reviewer wait");

const failedArtifact = { result: "FAIL", phase: "AUTHORITATIVE_VALIDATION", task: "TASK-99", head_sha: "head123", spec_sha256: manifest.spec_sha256 };
const failedValidation = resolveV14Decision(needsValidationRaw, { validation: failedArtifact, changedFiles: ["app/page.tsx"], specDigest: manifest.spec_sha256 });
assert.equal(failedValidation.transition, "VALIDATION_FAILED");

const validationArtifact = { result: "PASS", phase: "AUTHORITATIVE_VALIDATION", task: "TASK-99", head_sha: "head123", spec_sha256: manifest.spec_sha256 };
assert.equal(validationMatches(validationArtifact, { task: "TASK-99", head: "head123", specDigest: manifest.spec_sha256 }), true);
const afterValidation = resolveV14Decision(needsValidationRaw, { validation: validationArtifact, changedFiles: ["app/page.tsx"], specDigest: manifest.spec_sha256 });
assert.equal(afterValidation.transition, "PARKED_EXTERNAL_RETRYABLE", "after validation PASS, reviewer wait may be parked autonomously");
assert.equal(afterValidation.waited_transition, "WAIT_FOR_CODEX");

const rawRetryableBlock = {
  decision: { transition: "BLOCKED_EXTERNAL", waited_transition: "WAIT_FOR_CODEX", terminal: true, evidence: { last_error: "usage limit" }, pr_number: 25, pr_context: "TASK_PR" },
  pr: { number: 25, headRefOid: "head123" },
  state_summary: { resolved_task: "TASK-99" },
  task_spec: { present: true },
  ci: { headSha: "head123", status: "completed", conclusion: "success" },
};
const blockedWithoutValidation = resolveV14Decision(rawRetryableBlock, { validation: null, changedFiles: ["app/page.tsx"], specDigest: manifest.spec_sha256 });
assert.equal(blockedWithoutValidation.transition, "READY_FOR_VALIDATION", "legacy exhausted reviewer wait must not bypass validation");
const parked = resolveV14Decision(rawRetryableBlock, { validation: validationArtifact, changedFiles: ["app/page.tsx"], specDigest: manifest.spec_sha256 });
assert.equal(parked.transition, "PARKED_EXTERNAL_RETRYABLE");
assert.equal(parked.terminal, false, "retry budget exhaustion must not transfer control to the human after validation is satisfied");

const hardBlock = resolveV14Decision({ decision: { transition: "BLOCKED_EXTERNAL", terminal: true, reason: "credential requires login" } });
assert.equal(hardBlock.transition, "BLOCKED_EXTERNAL");
assert.equal(hardBlock.terminal, true);

assert.equal(retryDelaySeconds(0), 30);
assert.equal(retryDelaySeconds(999), 3600, "long waits slow to hourly cadence instead of becoming terminal");

const stats = deriveStats([
  { task: "TASK-99", pr: 1, review_round: 1, finding: "A" },
  { task: "TASK-99", pr: 1, review_round: 2, finding: "B" },
  { task: "TASK-99", event: "VALIDATION_FAIL" },
]);
assert.equal(stats.review_rounds, 2);
assert.equal(stats.validation_attempts, 1);
assert.equal(stats.validation_failures, 1);

console.log(JSON.stringify({
  ok: true,
  protocol: "RICK_LOOP_V1_4",
  checks: {
    task12_style_ac_parser: "PASS",
    spec_dod_precision_gate: "PASS",
    spec_anchored_ac_gate: "PASS",
    surviving_fault_fails: "PASS",
    exact_head_binding: "PASS",
    validation_before_review_wait: "PASS",
    validation_fail_blocks_review: "PASS",
    validation_pass_unlocks_retryable_review_wait: "PASS",
    legacy_exhausted_review_wait_cannot_bypass_validation: "PASS",
    retryable_external_never_terminal_by_budget: "PASS",
    stats_derived_from_events: "PASS",
  },
}, null, 2));
