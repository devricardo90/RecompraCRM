import { strict as assert } from "node:assert";

import { evaluatePreflight, validateJsonlLines, PREFLIGHT_CHECKS } from "./rick-loop-preflight.mjs";
import { evaluateDispatch, buildDispatchArgs, findRunForHead } from "./rick-loop-review-dispatch.mjs";

/**
 * ARCH-04 deterministic gate. No network: every case is synthetic, so this
 * proves the decision logic itself rather than the state of any real PR.
 */

const HEAD = "a".repeat(40);
const OTHER_HEAD = "b".repeat(40);

function okPr(overrides = {}) {
  return {
    number: 42,
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: "feat/example",
    headRefOid: HEAD,
    mergeable: "MERGEABLE",
    ...overrides,
  };
}

function okCi(overrides = {}) {
  return { databaseId: 1, headSha: HEAD, status: "completed", conclusion: "success", ...overrides };
}

function okPreflightInputs(overrides = {}) {
  return {
    state: { current_task: "ARCH-04" },
    handoff: { current_task: "ARCH-04" },
    registerLines: ['{"a":1}', "", '{"b":2}'],
    drift: [],
    pr: okPr(),
    ...overrides,
  };
}

// --- preflight ---------------------------------------------------------

{
  const result = evaluatePreflight(okPreflightInputs());
  assert.equal(result.pass, true, "a fully healthy input set must pass preflight");
  assert.deepEqual(result.reasons, [], "a passing preflight names no reasons");
  for (const name of PREFLIGHT_CHECKS) {
    assert.equal(result.checks[name], true, `check ${name} must pass on healthy input`);
  }
}

// Each check must be able to fail on its own, so a real failure is never
// masked by another check that happens to pass.
{
  const cases = [
    ["state_parseable", { state: null }],
    ["state_parseable", { state: {} }],
    ["handoff_parseable", { handoff: null }],
    ["register_valid_jsonl", { registerLines: ['{"a":1}', "{not json"] }],
    ["register_valid_jsonl", { registerLines: null }],
    ["no_state_drift", { drift: [{ code: "PR_POINTER_STALE" }] }],
    ["no_state_drift", { drift: null }],
    ["pr_open", { pr: okPr({ state: "MERGED" }) }],
    ["pr_not_draft", { pr: okPr({ isDraft: true }) }],
    ["pr_base_is_default", { pr: okPr({ baseRefName: "develop" }) }],
    ["pr_not_conflicting", { pr: okPr({ mergeable: "CONFLICTING" }) }],
    // UNKNOWN mergeability is unproven, not proven-safe: it must fail closed.
    ["pr_not_conflicting", { pr: okPr({ mergeable: "UNKNOWN" }) }],
  ];

  for (const [expectedFailure, override] of cases) {
    const result = evaluatePreflight(okPreflightInputs(override));
    assert.equal(result.pass, false, `${expectedFailure}: preflight must fail for ${JSON.stringify(override)}`);
    assert.ok(
      result.reasons.includes(expectedFailure),
      `${expectedFailure}: expected that reason, got ${JSON.stringify(result.reasons)}`,
    );
  }
}

// A missing PR fails every PR-scoped check rather than passing any of them.
{
  const result = evaluatePreflight(okPreflightInputs({ pr: null }));
  assert.equal(result.pass, false, "no PR must fail preflight");
  for (const name of ["pr_open", "pr_not_draft", "pr_base_is_default", "pr_not_conflicting"]) {
    assert.ok(result.reasons.includes(name), `missing PR must fail ${name}`);
  }
}

{
  assert.equal(validateJsonlLines(['{"a":1}', "", " "]).valid, true, "blank lines are not invalid JSONL");
  assert.equal(validateJsonlLines(["nope"]).invalidLine, 1, "the first bad line is reported by 1-based number");
  assert.equal(validateJsonlLines(['{"a":1}', "nope"]).invalidLine, 2, "the reported line number is the bad one");
  assert.equal(validateJsonlLines(null).valid, false, "a missing register is unknown, therefore invalid");
}

// --- dispatch decision -------------------------------------------------

const passingPreflight = { pass: true, checks: {}, reasons: [] };

{
  const decision = evaluateDispatch({ pr: okPr(), ci: okCi(), preflight: passingPreflight, existingRuns: [] });
  assert.equal(decision.dispatch, true, "CI green + preflight pass + no existing run must dispatch");
  assert.deepEqual(decision.blockers, [], "a dispatching decision names no blockers");
  assert.equal(decision.head, HEAD, "the decision carries the exact head");
  assert.equal(decision.branch, "feat/example", "the decision carries the PR branch for --ref");
}

{
  const cases = [
    ["pr_missing", { pr: null }],
    ["pr_not_open", { pr: okPr({ state: "CLOSED" }) }],
    ["draft", { pr: okPr({ isDraft: true }) }],
    ["conflicting", { pr: okPr({ mergeable: "CONFLICTING" }) }],
    ["ci_not_green", { ci: okCi({ conclusion: "failure" }) }],
    ["ci_not_green", { ci: okCi({ status: "in_progress", conclusion: null }) }],
    // CI green for a different commit is not CI green for this HEAD.
    ["ci_not_green", { ci: okCi({ headSha: OTHER_HEAD }) }],
    ["ci_not_green", { ci: null }],
    ["preflight_failed", { preflight: { pass: false, checks: {}, reasons: ["no_state_drift"] } }],
    ["preflight_failed", { preflight: null }],
    ["already_dispatched", { existingRuns: [{ databaseId: 9, headSha: HEAD, status: "completed", conclusion: "success" }] }],
    // Any status counts as dispatched; retrying a failed run is the watcher's job.
    ["already_dispatched", { existingRuns: [{ databaseId: 9, headSha: HEAD, status: "completed", conclusion: "failure" }] }],
    ["already_dispatched", { existingRuns: [{ databaseId: 9, headSha: HEAD, status: "in_progress", conclusion: null }] }],
    // An unreadable run list is unknown evidence and must fail closed.
    ["already_dispatched", { existingRuns: null }],
  ];

  for (const [expectedBlocker, override] of cases) {
    const decision = evaluateDispatch({
      pr: okPr(),
      ci: okCi(),
      preflight: passingPreflight,
      existingRuns: [],
      ...override,
    });
    assert.equal(decision.dispatch, false, `${expectedBlocker}: must not dispatch for ${JSON.stringify(override)}`);
    assert.ok(
      decision.blockers.includes(expectedBlocker),
      `${expectedBlocker}: expected that blocker, got ${JSON.stringify(decision.blockers)}`,
    );
  }
}

// A run for a different HEAD never satisfies this HEAD: a new commit must get
// its own review rather than inheriting the previous one's.
{
  const decision = evaluateDispatch({
    pr: okPr(),
    ci: okCi(),
    preflight: passingPreflight,
    existingRuns: [{ databaseId: 9, headSha: OTHER_HEAD, status: "completed", conclusion: "success" }],
  });
  assert.equal(decision.dispatch, true, "a run for another HEAD must not block this HEAD's dispatch");
}

// Idempotency as the loop actually experiences it: the second call sees the
// run the first one created and declines.
{
  const first = evaluateDispatch({ pr: okPr(), ci: okCi(), preflight: passingPreflight, existingRuns: [] });
  assert.equal(first.dispatch, true, "first call dispatches");
  const runsAfterFirst = [{ databaseId: 9, headSha: HEAD, status: "queued", conclusion: null }];
  const second = evaluateDispatch({ pr: okPr(), ci: okCi(), preflight: passingPreflight, existingRuns: runsAfterFirst });
  assert.equal(second.dispatch, false, "second call for the same HEAD must not dispatch again");
  assert.ok(second.blockers.includes("already_dispatched"), "the second call names already_dispatched");
}

{
  assert.equal(findRunForHead([{ headSha: HEAD }], HEAD)?.headSha, HEAD, "findRunForHead matches on exact sha");
  assert.equal(findRunForHead([{ headSha: OTHER_HEAD }], HEAD), null, "findRunForHead does not match another sha");
  assert.equal(findRunForHead(null, HEAD), null, "an unreadable list yields no match");
  assert.equal(findRunForHead([{ headSha: HEAD }], null), null, "no head yields no match");
}

// --- dispatch command --------------------------------------------------

{
  const args = buildDispatchArgs({ branch: "feat/example", prNumber: 42, headSha: HEAD });
  const refIndex = args.indexOf("--ref");
  assert.ok(refIndex !== -1, "the dispatch command must pass --ref");
  assert.equal(
    args[refIndex + 1],
    "feat/example",
    "--ref must name the PR branch; without it GitHub records the run against the default branch and neither the idempotency check nor selectClaudeReviewRun can find it",
  );
  assert.ok(args.includes(`pr_number=42`), "the PR number is passed as an input");
  assert.ok(args.includes(`expected_head_sha=${HEAD}`), "the exact head is passed as an input");
  assert.equal(args[0], "workflow", "the command is gh workflow run");
  assert.equal(args[1], "run", "the command is gh workflow run");
}

{
  assert.throws(() => buildDispatchArgs({ prNumber: 42, headSha: HEAD }), /--ref/, "a dispatch without a branch must throw");
  assert.throws(() => buildDispatchArgs({ branch: "b", headSha: HEAD }), /PR number/, "a dispatch without a PR number must throw");
  assert.throws(() => buildDispatchArgs({ branch: "b", prNumber: 42 }), /head sha/, "a dispatch without a head sha must throw");
}

console.log("ARCH-04 review dispatch checks: PASS");
