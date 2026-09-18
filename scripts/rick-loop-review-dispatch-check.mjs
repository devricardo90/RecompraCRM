import { strict as assert } from "node:assert";

import {
  evaluatePreflight,
  validateJsonlLines,
  PREFLIGHT_CHECKS,
  comparePointers,
  readRoadmapEntryFields,
  normalizePointerValue,
} from "./rick-loop-preflight.mjs";
import {
  evaluateDispatch,
  buildDispatchArgs,
  findRunForHead,
  classifyExistingRun,
  hasVerdictForHead,
  REDISPATCH_COOLDOWN_MS,
} from "./rick-loop-review-dispatch.mjs";
import {
  claudeReviewAction,
  claudeReviewRetryAction,
  classifyDispatchOutcome,
  redispatchFallbackAction,
} from "./rick-loop-watcher.mjs";

/**
 * ARCH-04 deterministic gate. No network: every case is synthetic, so this
 * proves the decision logic itself rather than the state of any real PR.
 */

const HEAD = "a".repeat(40);
const OTHER_HEAD = "b".repeat(40);
const PR_AUTHOR = "pr-author";
const REVIEWER = "claude[bot]";

// A verdict only counts as evidence when someone other than the PR author
// wrote it, mirroring the merge gate's independence rule.
const byReviewer = (body) => ({ body, user: { login: REVIEWER } });
const byAuthor = (body) => ({ body, user: { login: PR_AUTHOR } });
const asAuthored = { authorLogin: PR_AUTHOR };

function okPr(overrides = {}) {
  return {
    number: 42,
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: "feat/example",
    headRefOid: HEAD,
    mergeable: "MERGEABLE",
    author: { login: PR_AUTHOR },
    ...overrides,
  };
}

function okCi(overrides = {}) {
  return { databaseId: 1, headSha: HEAD, status: "completed", conclusion: "success", ...overrides };
}

function roadmapWith(fields = {}) {
  const lines = [
    "- [x] TASK-14 — Hardening",
    "  - impl_branch: feat/TASK-14-hardening",
    "- [ ] ARCH-04 — Governança de gatilho de revisão",
    ...Object.entries(fields).map(([k, v]) => `  - ${k}: ${v}`),
    "- [ ] ARCH-05 — Itens remanescentes",
    "  - impl_branch: none",
  ];
  return lines.join("\n");
}

const AGREEING_POINTERS = {
  state: { current_task: "ARCH-04", arch_04_impl_branch: "feat/x", arch_04_impl_stage: "STAGE1", next_action: "DO_THING" },
  handoff: { current_task: "ARCH-04", arch_04_impl_branch: "feat/x", arch_04_impl_stage: "STAGE1", next_action: "DO_THING" },
  roadmapText: roadmapWith({ impl_branch: "feat/x", impl_stage: "STAGE1", next_action: "DO_THING — com prosa explicativa" }),
};

function okPreflightInputs(overrides = {}) {
  return {
    ...AGREEING_POINTERS,
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

// --- the pointer gate ---------------------------------------------------
//
// The same fact lives in STATE.md, HANDOFF.md and the matching ROADMAP entry,
// and eight review rounds across PRs 36/37/38 caught it updated in two of the
// three - the last one inside a commit whose own message said all three had
// been swept. Nothing mechanical was looking. Now something is.

{
  // The exact drift from PR 38 round 2, reproduced: STATE and HANDOFF moved
  // to the Stage 1 branch, ROADMAP left on PR1's.
  const drifted = evaluatePreflight(okPreflightInputs({
    roadmapText: roadmapWith({ impl_branch: "feat/ARCH-04-review-dispatch", impl_stage: "STAGE1", next_action: "DO_THING" }),
    state: { ...AGREEING_POINTERS.state, arch_04_impl_branch: "feat/ARCH-04-secondary-reviewer" },
    handoff: { ...AGREEING_POINTERS.handoff, arch_04_impl_branch: "feat/ARCH-04-secondary-reviewer" },
  }));
  assert.equal(drifted.pass, false, "two-of-three pointer drift must fail preflight");
  assert.ok(drifted.reasons.includes("roadmap_pointers_agree"), "the failing check is named");
  assert.ok(
    drifted.reasons.some((r) => r.startsWith("pointer_disagreement:ARCH-04.impl_branch(")),
    `the reason names the pointer and each source's value, got ${JSON.stringify(drifted.reasons)}`,
  );
}

{
  // Trailing prose after an em dash is the ROADMAP's house style, not drift.
  const mismatches = comparePointers({
    state: { next_action: "DO_THING" },
    handoff: { next_action: "DO_THING" },
    roadmapText: roadmapWith({ next_action: "DO_THING — porque a PR ainda está aberta" }),
  });
  assert.deepEqual(mismatches, [], "explanatory prose after an em dash is not disagreement");
}

{
  // A pointer nobody records is nothing to disagree about; one source alone
  // has nothing to disagree with. Only two-or-more-and-differing is drift.
  assert.deepEqual(comparePointers({ state: {}, handoff: {}, roadmapText: roadmapWith({}) }), [], "absent everywhere is not drift");
  assert.deepEqual(
    comparePointers({ state: { arch_04_impl_branch: "feat/x" }, handoff: {}, roadmapText: roadmapWith({}) }),
    [],
    "present in one source only is not drift",
  );
  const twoSources = comparePointers({
    state: { arch_04_impl_stage: "STAGE1" },
    handoff: { arch_04_impl_stage: "STAGE2" },
    roadmapText: null,
  });
  assert.equal(twoSources.length, 1, "STATE and HANDOFF disagreeing is drift even with no roadmap available");
  assert.deepEqual(twoSources[0].values, { state: "STAGE1", handoff: "STAGE2" }, "both claimed values are reported");
}

{
  // The entry reader must not bleed fields across entry boundaries, or every
  // comparison would be against the wrong roadmap item.
  const text = roadmapWith({ impl_branch: "feat/x" });
  assert.equal(readRoadmapEntryFields(text, "ARCH-04").impl_branch, "feat/x", "reads the requested entry's field");
  assert.equal(readRoadmapEntryFields(text, "TASK-14").impl_branch, "feat/TASK-14-hardening", "reads a different entry independently");
  assert.equal(readRoadmapEntryFields(text, "ARCH-05").impl_branch, "none", "stops at the next entry heading");
  assert.equal(readRoadmapEntryFields(text, "TASK-99").__found, false, "an absent entry is reported as not found");
  assert.equal(readRoadmapEntryFields(text, "TASK-99").impl_branch, undefined, "an absent entry yields no fields");
}

{
  // A checked-off entry's fields are history: STATE/HANDOFF have legitimately
  // moved on to the next work, and comparing against them would manufacture
  // drift out of correct bookkeeping.
  const completed = [
    "- [x] ARCH-04 — Governança de gatilho de revisão",
    "  - impl_branch: feat/ARCH-04-secondary-reviewer",
    "  - next_action: DONE",
  ].join("\n");
  assert.deepEqual(
    comparePointers({
      state: { arch_04_impl_branch: "feat/TASK-15-something", next_action: "START_TASK_15" },
      handoff: { arch_04_impl_branch: "feat/TASK-15-something", next_action: "START_TASK_15" },
      roadmapText: completed,
    }),
    [],
    "a checked-off entry's historical fields are not compared against live pointers",
  );
  assert.equal(readRoadmapEntryFields(completed, "ARCH-04").__checked, true, "the reader reports the checkbox state");
}

{
  assert.equal(normalizePointerValue("VALUE — prose"), "VALUE", "the value token is taken before the em dash");
  assert.equal(normalizePointerValue("  VALUE  "), "VALUE", "surrounding whitespace is ignored");
  assert.equal(normalizePointerValue(null), null, "absent stays absent");
  assert.equal(normalizePointerValue("— only prose"), null, "a value that is only prose is absent, not empty-string drift");
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
    ["head_unknown", { pr: okPr({ headRefOid: null }) }],
    ["head_unknown", { pr: okPr({ headRefName: null }) }],
    ["already_dispatched", { existingRuns: [{ databaseId: 9, headSha: HEAD, status: "in_progress", conclusion: null }] }],
    ["already_dispatched", { existingRuns: [{ databaseId: 9, headSha: HEAD, status: "queued", conclusion: null }] }],
    // An unreadable run list is unknown evidence and must fail closed.
    ["already_dispatched", { existingRuns: null }],
    // A verdict already exists for this HEAD, so there is nothing to dispatch.
    [
      "already_reviewed",
      {
        existingRuns: [{ databaseId: 9, headSha: HEAD, status: "completed", conclusion: "success", updatedAt: "2026-09-17T12:00:00Z" }],
        comments: [byReviewer(`Reviewed commit: ${HEAD}\nNo major issues found.`)],
        now: new Date("2026-09-17T12:01:00Z"),
      },
    ],
    // Completed without a verdict, but too recent to re-dispatch yet.
    [
      "awaiting_redispatch_cooldown",
      {
        existingRuns: [{ databaseId: 9, headSha: HEAD, status: "completed", conclusion: "success", updatedAt: "2026-09-17T12:00:00Z" }],
        comments: [],
        now: new Date("2026-09-17T12:01:00Z"),
      },
    ],
    // An unreadable completion time is unknown age, so it waits rather than
    // re-dispatching immediately.
    [
      "awaiting_redispatch_cooldown",
      {
        existingRuns: [{ databaseId: 9, headSha: HEAD, status: "completed", conclusion: "success", updatedAt: "not-a-date" }],
        comments: [],
      },
    ],
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

// The stale-dispatch deadlock this protocol exists to prevent: the branch
// advances H1 -> H2 between the dispatcher reading the HEAD and GitHub
// accepting `gh workflow run --ref <branch>`, so the run is associated with H2
// while carrying H1 as expected_head_sha. The workflow correctly refuses to
// review the stale commit and skips, leaving a completed run on H2 that
// published nothing. If that run were allowed to reserve H2, H2 could never be
// reviewed: re-dispatch would be blocked and rerunning replays the same stale
// input forever.
{
  const staleSkippedRun = [{
    databaseId: 9,
    headSha: HEAD,
    status: "completed",
    conclusion: "success",
    updatedAt: "2026-09-17T12:00:00Z",
  }];
  const wellAfterCooldown = new Date(Date.parse("2026-09-17T12:00:00Z") + REDISPATCH_COOLDOWN_MS + 1000);

  const decision = evaluateDispatch({
    pr: okPr(),
    ci: okCi(),
    preflight: passingPreflight,
    existingRuns: staleSkippedRun,
    comments: [],
    now: wellAfterCooldown,
  });
  assert.equal(
    decision.dispatch,
    true,
    "a completed run that published no verdict for this HEAD must not reserve it forever; re-dispatch is the only way that HEAD ever gets reviewed",
  );
  assert.equal(decision.run_state, "STALE_NO_VERDICT", "the decision names why re-dispatch was allowed");

  // Same run, but it did publish a verdict for this HEAD: nothing to redo.
  const reviewed = evaluateDispatch({
    pr: okPr(),
    ci: okCi(),
    preflight: passingPreflight,
    existingRuns: staleSkippedRun,
    comments: [byReviewer(`Reviewed commit: ${HEAD}\nReview result: FINDINGS`)],
    now: wellAfterCooldown,
  });
  assert.equal(reviewed.dispatch, false, "a HEAD with a published verdict must not be dispatched again");
  assert.ok(reviewed.blockers.includes("already_reviewed"), "that case is named already_reviewed");
}

{
  assert.equal(classifyExistingRun(null, {}), "NONE", "no run is NONE");
  assert.equal(classifyExistingRun({ status: "in_progress" }, {}), "IN_FLIGHT", "a running review is IN_FLIGHT");
  assert.equal(classifyExistingRun({ status: "queued" }, {}), "IN_FLIGHT", "a queued review is IN_FLIGHT");
  assert.equal(
    classifyExistingRun({ status: "completed", updatedAt: "2026-09-17T12:00:00Z" }, { verdictPublished: true }),
    "REVIEWED",
    "a completed run with a verdict for the head is REVIEWED",
  );
}

{
  assert.equal(hasVerdictForHead([byReviewer(`Reviewed commit: ${HEAD}\nNo major issues found.`)], HEAD, asAuthored), true, "a clean verdict counts");
  assert.equal(hasVerdictForHead([byReviewer(`Reviewed commit: ${HEAD}\nReview result: FINDINGS`)], HEAD, asAuthored), true, "a findings verdict counts too");
  assert.equal(hasVerdictForHead([byReviewer(`Reviewed commit: ${OTHER_HEAD}\nNo major issues found.`)], HEAD, asAuthored), false, "another head's verdict does not count");

  // Independence, mirroring the merge gate: a verdict the PR author wrote is
  // not evidence anyone reviewed anything. Trusting it would let a forged
  // comment convince the dispatcher this HEAD is done and stall the loop for
  // good - the merge gate would still refuse to merge, so nothing unsafe
  // lands, but no real review would ever be dispatched either.
  assert.equal(
    hasVerdictForHead([byAuthor(`Reviewed commit: ${HEAD}\nNo major issues found.`)], HEAD, asAuthored),
    false,
    "a verdict written by the PR author is not independent evidence",
  );
  assert.equal(
    hasVerdictForHead([{ body: `Reviewed commit: ${HEAD}\nNo major issues found.` }], HEAD, asAuthored),
    false,
    "a comment with no identifiable author fails closed rather than being trusted",
  );
  assert.equal(
    hasVerdictForHead([byReviewer(`Reviewed commit: ${HEAD}\nNo major issues found.`)], HEAD),
    false,
    "an unknown PR author means independence cannot be judged, so it fails closed",
  );
  assert.equal(
    hasVerdictForHead([byAuthor("chatter"), byReviewer(`Reviewed commit: ${HEAD}\nNo major issues found.`)], HEAD, asAuthored),
    true,
    "an author comment alongside a genuine reviewer verdict does not suppress it",
  );
  assert.equal(hasVerdictForHead([], HEAD, asAuthored), false, "no comments means no verdict");
  assert.equal(hasVerdictForHead(null, HEAD, asAuthored), false, "an unreadable comment list means no verdict");
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

// --- watcher-level decision ------------------------------------------
//
// The same deadlock, at the level that the running loop actually executes.
// Fixing evaluateDispatch alone was not enough: retryClaudeReview never
// reached it once a stale run existed, because claudeReviewRetryAction keys on
// headSha only and cycles WAIT -> COOLDOWN -> RERUN forever, and rerunning
// replays the stale expected_head_sha.

{
  const staleRun = { databaseId: 9, headSha: HEAD, status: "completed", conclusion: "success", updatedAt: "2026-09-17T12:00:00Z" };
  const completedAt = Date.parse("2026-09-17T12:00:00Z");
  // Pinned to the re-dispatch boundary itself, not to some loose later time.
  // A loose assertion here previously passed while the watcher was silently
  // falling back to the one-hour rerun cooldown, hiding the fact that the
  // ten-minute constant never applied on the live path at all.
  const justBeforeCooldown = new Date(completedAt + REDISPATCH_COOLDOWN_MS - 1000);
  const justAfterCooldown = new Date(completedAt + REDISPATCH_COOLDOWN_MS + 1000);
  const afterCooldown = justAfterCooldown;
  const withinCooldown = justBeforeCooldown;

  assert.equal(
    claudeReviewAction({ run: staleRun, verdictPublished: false, now: justBeforeCooldown }),
    "COOLDOWN",
    "one second before the re-dispatch cooldown elapses, the watcher still waits",
  );
  assert.equal(
    claudeReviewAction({ run: staleRun, verdictPublished: false, now: justAfterCooldown }),
    "REDISPATCH",
    "one second after it elapses the watcher re-dispatches - proving the ten-minute constant, not the one-hour rerun cooldown, governs this path",
  );

  assert.equal(claudeReviewAction({ run: null }), "DISPATCH", "no run at all means dispatch");
  assert.equal(
    claudeReviewAction({ run: { ...staleRun, status: "in_progress" } }),
    "WAIT",
    "a review still running is never disturbed",
  );
  assert.equal(
    claudeReviewAction({ run: staleRun, verdictPublished: true, now: afterCooldown }),
    "REVIEWED",
    "a head with a published verdict needs nothing further",
  );
  assert.equal(
    claudeReviewAction({ run: staleRun, verdictPublished: false, now: withinCooldown }),
    "COOLDOWN",
    "a recently completed run without a verdict waits out the cooldown",
  );
  assert.equal(
    claudeReviewAction({ run: staleRun, verdictPublished: false, now: afterCooldown }),
    "REDISPATCH",
    "completed, no verdict, cooldown elapsed: re-dispatch with a freshly resolved head rather than rerunning a stale input",
  );
  assert.equal(
    claudeReviewAction({ run: { ...staleRun, updatedAt: "not-a-date" }, verdictPublished: false, now: afterCooldown }),
    "WAIT",
    "an undateable run waits rather than acting on evidence it cannot age",
  );

  // The regression itself: the old headSha-only decision said RERUN, which is
  // precisely the action that cannot break the deadlock.
  // The legacy decision keeps its own one-hour cooldown, so it needs its own
  // timestamp: at the ten-minute mark it is still in COOLDOWN, which is
  // exactly the gap that made REDISPATCH_COOLDOWN_MS dead on the live path
  // until the watcher stopped falling back to the legacy default.
  const pastLegacyCooldown = new Date(completedAt + 2 * 60 * 60 * 1000);
  assert.equal(
    claudeReviewRetryAction(staleRun, { now: justAfterCooldown }),
    "COOLDOWN",
    "at the re-dispatch boundary the legacy decision is still waiting - the two cooldowns are genuinely different, not aliases",
  );
  assert.equal(
    claudeReviewRetryAction(staleRun, { now: pastLegacyCooldown }),
    "RERUN",
    "the legacy decision still returns RERUN for this shape - retained for the v1.4 suite, but no longer what the watcher acts on",
  );
  assert.notEqual(
    claudeReviewAction({ run: staleRun, verdictPublished: false, now: afterCooldown }),
    "RERUN",
    "the verdict-aware decision must not choose RERUN for a run that published nothing",
  );
}

// --- verdict evidence must be paged ------------------------------------
//
// GitHub returns issue comments oldest-first. A single unpaginated page drops
// the newest ones on a long-lived PR - exactly where the verdict for the
// current HEAD lives - so hasVerdictForHead would report "no verdict" for a
// HEAD that was reviewed, and the loop would re-dispatch for nothing.

{
  const olderComments = Array.from({ length: 100 }, (_, i) => ({ body: `chatter ${i}` }));
  const verdictOnPageTwo = [byReviewer(`Reviewed commit: ${HEAD}\nNo major issues found.`)];

  assert.equal(
    hasVerdictForHead(olderComments, HEAD, asAuthored),
    false,
    "page one alone carries no verdict in this shape - this is what the unpaginated fetch used to see",
  );
  assert.equal(
    hasVerdictForHead([...olderComments, ...verdictOnPageTwo], HEAD, asAuthored),
    true,
    "the verdict is only visible once every page is walked",
  );

  // And the dispatch decision must flip accordingly: truncated evidence would
  // re-dispatch a HEAD that already has a verdict.
  const completedRun = [{ databaseId: 9, headSha: HEAD, status: "completed", conclusion: "success", updatedAt: "2026-09-17T12:00:00Z" }];
  const afterCooldown = new Date(Date.parse("2026-09-17T12:00:00Z") + REDISPATCH_COOLDOWN_MS + 1000);

  assert.equal(
    evaluateDispatch({ pr: okPr(), ci: okCi(), preflight: passingPreflight, existingRuns: completedRun, comments: olderComments, now: afterCooldown }).dispatch,
    true,
    "with the verdict truncated away, the decision wrongly re-dispatches",
  );
  assert.equal(
    evaluateDispatch({ pr: okPr(), ci: okCi(), preflight: passingPreflight, existingRuns: completedRun, comments: [...olderComments, ...verdictOnPageTwo], now: afterCooldown }).dispatch,
    false,
    "with the full comment list, the already-reviewed HEAD is left alone",
  );
}

// --- a verdict outlives the run-list window -----------------------------
//
// `gh run list --limit 20` is a window. On a PR several review rounds deep the
// run that produced an earlier HEAD's verdict scrolls out of it. If the
// decision asked about the run before the verdict, it would see no run, call
// the HEAD unreviewed, and dispatch a second review for work already done.

{
  const verdict = [byReviewer(`Reviewed commit: ${HEAD}\nNo major issues found.`)];

  assert.equal(
    classifyExistingRun(null, { verdictPublished: true }),
    "REVIEWED",
    "a published verdict settles the HEAD even when its run has aged out of the listing window",
  );
  assert.equal(
    claudeReviewAction({ run: null, verdictPublished: true }),
    "REVIEWED",
    "the watcher path must not dispatch for a HEAD whose verdict outlived its run",
  );
  assert.equal(
    claudeReviewAction({ run: null, verdictPublished: false }),
    "DISPATCH",
    "with no run and no verdict there is genuinely nothing, so dispatch",
  );

  assert.equal(
    evaluateDispatch({ pr: okPr(), ci: okCi(), preflight: passingPreflight, existingRuns: [], comments: verdict }).dispatch,
    false,
    "an empty run list plus a verdict for this HEAD must not re-dispatch",
  );
  assert.ok(
    evaluateDispatch({ pr: okPr(), ci: okCi(), preflight: passingPreflight, existingRuns: [], comments: verdict }).blockers.includes("already_reviewed"),
    "and it is named already_reviewed, not already_dispatched",
  );
}

// --- dispatch outcome diagnostics ---------------------------------------
//
// BLOCKED and DISPATCH_FAILED exit the same way but mean opposite things
// during rollout, and inverting them would send triage the wrong direction
// with nothing in CI to notice.

{
  assert.equal(
    classifyDispatchOutcome({ dispatch: false, blockers: ["ci_not_green"] }),
    "BLOCKED",
    "the dispatcher's own pre-checks refusing is a normal not-yet-ready state",
  );
  assert.equal(
    classifyDispatchOutcome({ dispatch: true, dispatched: false }),
    "DISPATCH_FAILED",
    "pre-checks passed and the gh workflow run call itself failed - the expected bootstrap-window shape, not a block",
  );
  assert.equal(classifyDispatchOutcome(null), "ERROR", "unparseable output is neither blocked nor failed-to-dispatch");
}

// --- what happens after a failed re-dispatch ----------------------------
//
// The rerun fallback exists for exactly one situation: the bootstrap window,
// where claude-pr-review.yml has no workflow_dispatch trigger yet so the
// dispatch cannot land. Letting it also fire on a pre-check block would rerun
// the stale run this mechanism exists to stop trusting, bumping its updatedAt
// and resetting the cooldown - the same "this HEAD can never be reviewed"
// failure, reached from a different direction.

{
  assert.equal(
    redispatchFallbackAction({ dispatched: true }),
    "DISPATCHED",
    "a landed dispatch needs no fallback",
  );
  assert.equal(
    redispatchFallbackAction({ dispatched: false, reason: "DISPATCH_FAILED" }),
    "RERUN",
    "pre-checks passed and the dispatch call failed - the bootstrap-window case the fallback exists for",
  );
  assert.equal(
    redispatchFallbackAction({ dispatched: false, reason: "BLOCKED" }),
    "WAIT",
    "a transient pre-check block must not rerun the stale run and reset its cooldown",
  );
  assert.equal(
    redispatchFallbackAction({ dispatched: false, reason: "ERROR" }),
    "WAIT",
    "an unreadable dispatch result is not evidence that rerunning is safe",
  );
  assert.equal(redispatchFallbackAction(null), "WAIT", "no dispatch result at all waits");
}

console.log("ARCH-04 review dispatch checks: PASS");
