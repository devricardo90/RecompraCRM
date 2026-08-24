import assert from "node:assert/strict";
import { analyzeAcceptanceCriteria, analyzeDodAcCoverage, evaluateValidation, sha256 } from "./rick-loop-validation.mjs";
import { isDocsOnly, resolveV14Decision, validationMatches } from "./rick-loop-supervisor.mjs";
import { claudeReviewRetryAction, retryDelaySeconds, selectClaudeReviewRun } from "./rick-loop-watcher.mjs";
import { deriveStats, findingKeys, parseFindingClasses } from "./rick-loop-stats.mjs";

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
const decisionOpts = { baseline: "base123", changedFiles: ["app/page.tsx"], specDigest: manifest.spec_sha256 };
const needsValidation = resolveV14Decision(needsValidationRaw, { ...decisionOpts, validation: null });
assert.equal(needsValidation.transition, "READY_FOR_VALIDATION", "green tests cannot jump directly to reviewer wait");

const failedArtifact = { result: "FAIL", phase: "AUTHORITATIVE_VALIDATION", task: "TASK-99", base_sha: "base123", head_sha: "head123", spec_sha256: manifest.spec_sha256 };
const failedValidation = resolveV14Decision(needsValidationRaw, { ...decisionOpts, validation: failedArtifact });
assert.equal(failedValidation.transition, "VALIDATION_FAILED");

const validationArtifact = { result: "PASS", phase: "AUTHORITATIVE_VALIDATION", task: "TASK-99", base_sha: "base123", head_sha: "head123", spec_sha256: manifest.spec_sha256 };
assert.equal(validationMatches(validationArtifact, { task: "TASK-99", baseline: "base123", head: "head123", specDigest: manifest.spec_sha256 }), true);
const afterValidation = resolveV14Decision(needsValidationRaw, { ...decisionOpts, validation: validationArtifact });
assert.equal(afterValidation.transition, "PARKED_EXTERNAL_RETRYABLE", "after validation PASS, reviewer wait may be parked autonomously");

const forgedBaseline = { ...validationArtifact, base_sha: "head123" };
assert.equal(validationMatches(forgedBaseline, { task: "TASK-99", baseline: "base123", head: "head123", specDigest: manifest.spec_sha256 }), false, "manifest cannot choose its own baseline");
const forgedDecision = resolveV14Decision(needsValidationRaw, { ...decisionOpts, validation: forgedBaseline });
assert.equal(forgedDecision.transition, "READY_FOR_VALIDATION", "forged base cannot unlock review");

const rawRetryableBlock = {
  decision: { transition: "BLOCKED_EXTERNAL", waited_transition: "WAIT_FOR_CODEX", terminal: true, evidence: { last_error: "usage limit" }, pr_number: 25, pr_context: "TASK_PR" },
  pr: { number: 25, headRefOid: "head123" },
  state_summary: { resolved_task: "TASK-99" },
  task_spec: { present: true },
  ci: { headSha: "head123", status: "completed", conclusion: "success" },
};
const blockedWithoutValidation = resolveV14Decision(rawRetryableBlock, { ...decisionOpts, validation: null });
assert.equal(blockedWithoutValidation.transition, "READY_FOR_VALIDATION", "legacy exhausted reviewer wait must not bypass validation");
const parked = resolveV14Decision(rawRetryableBlock, { ...decisionOpts, validation: validationArtifact });
assert.equal(parked.transition, "PARKED_EXTERNAL_RETRYABLE");
assert.equal(parked.terminal, false, "retry budget exhaustion must not transfer control to the human after validation is satisfied");

const hardBlock = resolveV14Decision({ decision: { transition: "BLOCKED_EXTERNAL", terminal: true, reason: "credential requires login" } });
assert.equal(hardBlock.transition, "BLOCKED_EXTERNAL");
assert.equal(hardBlock.terminal, true);

const reviewRuns = [
  { databaseId: 10, headSha: "old", status: "completed", conclusion: "success", updatedAt: "2026-08-24T10:00:00Z" },
  { databaseId: 11, headSha: "head123", status: "in_progress", conclusion: null, updatedAt: "2026-08-24T15:00:00Z" },
];
assert.equal(selectClaudeReviewRun(reviewRuns, "head123")?.databaseId, 11, "review retry must be exact-head scoped");
assert.equal(claudeReviewRetryAction(reviewRuns[1], { now: new Date("2026-08-24T15:30:00Z") }), "WAIT", "never rerun an active Claude review");
assert.equal(claudeReviewRetryAction({ databaseId: 12, headSha: "head123", status: "completed", conclusion: "failure", updatedAt: "2026-08-24T15:20:00Z" }, { now: new Date("2026-08-24T15:30:00Z") }), "COOLDOWN", "restart-safe cooldown comes from GitHub run facts");
assert.equal(claudeReviewRetryAction({ databaseId: 12, headSha: "head123", status: "completed", conclusion: "failure", updatedAt: "2026-08-24T13:00:00Z" }, { now: new Date("2026-08-24T15:30:00Z") }), "RERUN");
assert.equal(claudeReviewRetryAction(null), "NO_RUN");

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
    independent_baseline_binding: "PASS",
    validation_before_review_wait: "PASS",
    validation_fail_blocks_review: "PASS",
    validation_pass_unlocks_retryable_review_wait: "PASS",
    legacy_exhausted_review_wait_cannot_bypass_validation: "PASS",
    claude_review_retry_exact_head: "PASS",
    claude_review_retry_restart_safe_cooldown: "PASS",
    active_claude_review_not_duplicated: "PASS",
    retryable_external_never_terminal_by_budget: "PASS",
    stats_derived_from_events: "PASS",
  },
}, null, 2));

// --- DoD coverage is the union of every declared range, not each range alone ---
function specWithAcs(count, dodText) {
  const acs = Array.from({ length: count }, (_, index) => `AC${index + 1}. criterio ${index + 1}`).join("\n");
  return `## Critérios de aceite\n\n${acs}\n\n## Definition of Done\n\n${dodText}\n`;
}
const acs22 = analyzeAcceptanceCriteria(specWithAcs(22, "")).ids;
assert.equal(acs22.length, 22, "fixture must expose AC1 through AC22");

const contiguous = analyzeDodAcCoverage(specWithAcs(22, "AC1 a AC10 provados\nAC11 a AC22 provados"), acs22);
assert.deepEqual(contiguous.gaps, [], "two ranges that jointly cover every AC must pass");

const missingMiddle = analyzeDodAcCoverage(specWithAcs(22, "AC1 a AC10 provados\nAC12 a AC22 provados"), acs22);
assert.deepEqual(missingMiddle.gaps, ["DOD_AC_COVERAGE_GAP_AC-11"], "an AC covered by no range must fail");

const staleRange = analyzeDodAcCoverage(specWithAcs(22, "AC1 a AC17 provados"), acs22);
assert.equal(staleRange.gaps.length, 5, "the original stale case must still fail");
assert.equal(staleRange.gaps.includes("DOD_AC_COVERAGE_GAP_AC-18"), true);
assert.equal(staleRange.gaps.includes("DOD_AC_COVERAGE_GAP_AC-22"), true);

const beyondSpec = analyzeDodAcCoverage(specWithAcs(22, "AC1 a AC22 provados\nAC23 a AC24 provados"), acs22);
assert.equal(beyondSpec.gaps.includes("DOD_AC_RANGE_OUT_OF_SPEC_AC-23"), true, "claiming an AC the spec does not define is a spec-precision gap");
assert.equal(beyondSpec.gaps.includes("DOD_AC_RANGE_OUT_OF_SPEC_AC-24"), true);

const overlapping = analyzeDodAcCoverage(specWithAcs(22, "AC1 a AC15 provados\nAC10 a AC22 provados"), acs22);
assert.deepEqual(overlapping.gaps, [], "overlapping ranges are fine as long as the union is exact");

const reversed = analyzeDodAcCoverage(specWithAcs(22, "AC22 a AC1 provados"), acs22);
assert.equal(reversed.gaps.includes("DOD_AC_RANGE_INVALID_AC-22_AC-01"), true, "a reversed range proves nothing");
assert.equal(reversed.gaps.length > 1, true, "a reversed range must also leave the ACs uncovered");

assert.deepEqual(analyzeDodAcCoverage(specWithAcs(22, "todos os criterios provados"), acs22).gaps, [], "a DoD that states no range makes no coverage claim to contradict");

const multiRangeSpec = specWithAcs(22, "AC1 a AC10 provados\nAC11 a AC22 provados");
assert.equal(
  evaluateValidation({ ...manifest }, { ...baseContext, specText: multiRangeSpec }).failures.some((entry) => entry.code === "SPEC_DOD_AC_RANGE_STALE"),
  false,
  "a correctly split DoD must not raise SPEC_DOD_AC_RANGE_STALE",
);

// --- docs-only classification is explicit and fails closed ---
for (const file of ["docs/evidence/example.md", "docs/evidence/example.json", "docs/specs/TASK-12.md", "docs/operations/HANDOFF.md"]) {
  assert.equal(isDocsOnly([file]), true, `${file} must remain docs-only`);
}
for (const file of ["docs/evidence/payload.mjs", "docs/evidence/script.ts", "docs/evidence/workflow.yml", "docs/evidence/no-extension", "app/page.tsx"]) {
  assert.equal(isDocsOnly([file]), false, `${file} must not earn a docs-only bypass`);
}
assert.equal(isDocsOnly(["docs/evidence/example.md", "app/page.tsx"]), false, "one executable file removes the docs-only bypass for the whole set");
assert.equal(isDocsOnly(["docs/evidence/example.md", "docs/evidence/payload.mjs"]), false, "an executable evidence file removes the bypass");
assert.equal(isDocsOnly([]), false, "an empty change set is never docs-only");

// --- finding classes are counted individually ---
assert.deepEqual(parseFindingClasses("A"), ["A"], "a single class is preserved");
assert.deepEqual(parseFindingClasses("A,B,C"), ["A", "B", "C"], "comma-separated classes are split");
assert.deepEqual(parseFindingClasses("  A , B  "), ["A", "B"], "whitespace around separators is trimmed");
assert.deepEqual(parseFindingClasses("A,,B,"), ["A", "B"], "empty fragments are ignored");
assert.deepEqual(parseFindingClasses(""), [], "an empty field contributes nothing");
assert.deepEqual(parseFindingClasses(null), [], "a missing field contributes nothing");
assert.deepEqual(findingKeys({ finding: "A", finding_2: "B", finding_4: "D", other: "x" }), ["finding", "finding_2", "finding_4"], "every finding field is counted, not just the first two");

const findingStats = deriveStats([
  { task: "TASK-A", finding: "P2_SALE_ITEM_GUARD_WRITE_SKEW,P2_STALE_HANDOFF_STATE_RECORD,P2_STALE_ROADMAP_RECORD" },
  { task: "TASK-A", finding: " P1_ONE ", finding_2: "P1_TWO,P1_THREE" },
  { task: "TASK-B", finding: "P1_ONE" },
]);
assert.equal(findingStats.findings, 7, "each class counts once, so three combined plus three plus one is seven");
assert.deepEqual(
  findingStats.distinct_finding_classes,
  ["P1_ONE", "P1_THREE", "P1_TWO", "P2_SALE_ITEM_GUARD_WRITE_SKEW", "P2_STALE_HANDOFF_STATE_RECORD", "P2_STALE_ROADMAP_RECORD"],
  "distinct classes are normalized individual classes, and a duplicate across tasks collapses",
);
assert.equal(findingStats.findings > findingStats.distinct_finding_classes.length, true, "total findings and distinct classes differ when a class repeats");
assert.equal(findingStats.by_task["TASK-A"].findings, 6, "per-task findings count classes, not fields");
assert.equal(findingStats.by_task["TASK-B"].findings, 1, "a single-class field still counts once");

console.log("Rick Loop v1.4 review-finding regressions: PASS");
