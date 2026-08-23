import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CANONICAL_TASK_STATES,
  parseFlatYaml,
  countRoadmapTasks,
  classifyDocsOnlyDiff,
  taskFromBranch,
  deriveCanonicalTaskState,
  selectAnchoredReview,
  selectAnchoredCleanComment,
  hasExplicitCleanVerdict,
  countUnresolvedFindings,
  isCleanReviewResult,
  filterAnchoredCleanComments,
  buildAnchoredResults,
  selectMergeResult,
  collectPagedList,
  TERMINAL_TRANSITIONS,
  WAIT_TRANSITIONS,
  isTerminalTransition,
  isWaitTransition,
  evaluateWaitEscalation,
  describeReentry,
  reconstructWaitFromFacts,
  waitMatchesDecision,
  applyWaitEscalation,
  MAX_WAIT_POLLS,
  evaluateMergeAllowed,
  evaluateArchitectureComplexitySignal,
  detectStateDrift,
  parseRoadmapPlan,
  resolveNextEligibleTask,
  resolveEffectiveTask,
  classifyLoopDecision,
  WAIT_BACKOFF_SECONDS,
  backoffSecondsForPollCount,
  startWait,
  recordPoll,
  nextStagnationState,
  prewriteKey,
  startPrewrite,
  samePrewriteIntent,
  completePrewrite,
  loadRuntimeState,
  saveRuntimeState,
  loadPrewriteState,
  savePrewriteState,
} from "./rick-loop-controller.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }

try {
  const parsed = parseFlatYaml(`\n\`\`\`yaml\nmode: CONTROLLED_AUTONOMOUS\nattempt: 7\nnext_action_authorized: true\nupdated_at: "2026-08-10T18:22:00Z"\ncompleted_tasks:\n  - TASK-01\n  - TASK-02\n\`\`\`\n`);
  assert(parsed.mode === "CONTROLLED_AUTONOMOUS", "flat scalar not parsed");
  assert(parsed.attempt === 7, "numeric value not parsed as number");
  assert(parsed.next_action_authorized === true, "boolean value not parsed");
  assert(parsed.updated_at === "2026-08-10T18:22:00Z", "quoted string not unquoted");
  assert(Array.isArray(parsed.completed_tasks) && parsed.completed_tasks.length === 2, "list not parsed");

  const roadmap = countRoadmapTasks(`\n- [x] TASK-01 — done\n- [x] TASK-02 — done\n- [ ] TASK-03 — pending\n`);
  assert(roadmap.done === 2 && roadmap.pending === 1 && roadmap.total === 3, "roadmap count wrong");
  assert(countRoadmapTasks("- [x] TASK-01 — done\n").pending === 0, "complete roadmap not detected");
  assert(classifyDocsOnlyDiff(["docs/operations/STATE.md", "docs/specs/TASK-09.md"]), "docs/spec allowlist wrong");
  assert(!classifyDocsOnlyDiff(["docs/operations/STATE.md", "prisma/schema.prisma"]), "code file misclassified");
  assert(!classifyDocsOnlyDiff([]), "empty diff must not be docs-only");

  const taskSelectionRoadmap = parseRoadmapPlan(`
- [x] TASK-06 — products
- [x] TASK-08 — stock
- [x] TASK-09 — forecast
- [x] TASK-11 — history
- [ ] TASK-12 — repurchase dashboard
  - depends_on: TASK-09, TASK-11, ARCH-01
  - blocked_by: ARCH-01 — decide forecast persistence first
- [ ] TASK-13 — stock dashboard
  - depends_on: TASK-06, TASK-08
- [ ] TASK-14 — hardening
  - depends_on: TASK-01..TASK-13
- [ ] ARCH-01 — persisted vs computed forecast
  - blocking: false
  - status: OPEN
`);
  const selectedFallback = resolveNextEligibleTask(taskSelectionRoadmap);
  assert(selectedFallback.task === "TASK-13", `blocked TASK-12 must fall through to TASK-13, got ${selectedFallback.task}`);
  assert(selectedFallback.skipped.length === 1 && selectedFallback.skipped[0].task === "TASK-12", "TASK-12 must be recorded as skipped");
  assert(selectedFallback.skipped[0].blockers.some((blocker) => blocker.reference === "ARCH-01"), "ARCH-01 must be the explicit TASK-12 blocker");

  const resolvedArchitectureRoadmap = parseRoadmapPlan(`
- [x] TASK-09 — forecast
- [x] TASK-11 — history
- [ ] TASK-12 — repurchase dashboard
  - depends_on: TASK-09, TASK-11, ARCH-01
  - blocked_by: ARCH-01
- [ ] TASK-13 — stock dashboard
  - depends_on: TASK-06, TASK-08
- [ ] ARCH-01 — persisted vs computed forecast
  - blocking: false
  - status: RESOLVED
`);
  assert(resolveNextEligibleTask(resolvedArchitectureRoadmap).task === "TASK-12", "resolved ARCH-01 must make TASK-12 eligible again");

  const noEligibleRoadmap = parseRoadmapPlan(`
- [ ] TASK-12 — repurchase dashboard
  - depends_on: ARCH-01
- [ ] TASK-13 — stock dashboard
  - depends_on: TASK-99
- [ ] ARCH-01 — decision
  - status: OPEN
`);
  const noEligible = resolveNextEligibleTask(noEligibleRoadmap);
  assert(noEligible.task === null && noEligible.reason === "NO_ELIGIBLE_TASK", "all-blocked roadmap must not invent a task");
  assert(noEligible.skipped.length === 2, "all blocked tasks must be explained");

  assert(CANONICAL_TASK_STATES.includes("RECOVERING"), "canonical task states missing RECOVERING");
  assert(taskFromBranch("feat/TASK-09-repurchase-forecast") === "TASK-09", "task branch parse failed");
  assert(taskFromBranch("main") === null, "main must not parse as task branch");

  const openPr = { number: 14, state: "OPEN", headRefName: "feat/TASK-09-repurchase-forecast", headRefOid: "abc123" };
  const greenCi = { status: "completed", conclusion: "success" };
  const currentReview = { headRefOid: "abc123", lastReview: { submittedAt: "now" }, anchored: { submittedAt: "now" } };
  const staleReview = { headRefOid: "abc123", lastReview: { submittedAt: "then", commit: { oid: "old999" } }, anchored: null };
  assert(deriveCanonicalTaskState({ git: { branch: "main" }, pr: null, review: null, ci: null }) === "READY", "main/no PR should be READY");
  assert(deriveCanonicalTaskState({ git: { branch: "feat/TASK-09-x" }, pr: null, review: null, ci: null }) === "IMPLEMENTING", "task branch/no PR should be IMPLEMENTING");
  assert(deriveCanonicalTaskState({ git: {}, pr: openPr, review: null, ci: null }) === "WAIT_CI", "open PR/no CI should WAIT_CI");
  assert(deriveCanonicalTaskState({ git: {}, pr: openPr, review: null, ci: greenCi }) === "WAIT_REVIEW", "green CI/no review should WAIT_REVIEW");
  assert(deriveCanonicalTaskState({ git: {}, pr: openPr, review: currentReview, ci: greenCi }) === "REVIEW_LANDED", "current review should land");
  assert(
    deriveCanonicalTaskState({ git: {}, pr: openPr, review: staleReview, ci: greenCi }) === "WAIT_REVIEW",
    "a review anchored to an older SHA must not satisfy the gate for the current HEAD",
  );

  const reviews = [
    { commit: { oid: "old999" }, submittedAt: "t1" },
    { commit: { oid: "abc123" }, submittedAt: "t2" },
    { commit: { oid: "old999" }, submittedAt: "t3" },
  ];
  assert(selectAnchoredReview(reviews, "abc123")?.submittedAt === "t2", "anchored review not selected by exact SHA");
  assert(selectAnchoredReview(reviews, "nothere") === null, "non-matching SHA must not anchor");
  assert(selectAnchoredReview(null, "abc123") === null, "missing reviews must not anchor");

  const comments = [
    { body: "Codex Review: Didn't find any major issues.\n\n**Reviewed commit:** `old999abcd`", createdAt: "c1" },
    { body: "Codex Review: Didn't find any major issues.\n\n**Reviewed commit:** `abc123def0`", createdAt: "c2" },
    { body: "unrelated chatter mentioning abc123", createdAt: "c3" },
  ];
  assert(selectAnchoredCleanComment(comments, "abc123def0aaaa")?.createdAt === "c2", "clean comment not anchored by abbreviated SHA");
  assert(selectAnchoredCleanComment(comments, "zzz000") === null, "clean comment must not anchor to a different SHA");
  assert(selectAnchoredCleanComment([{ body: "Reviewed commit: `abc123def0`" }], "abc123def0") === null, "a comment without a clean verdict must not anchor");

  assert(hasExplicitCleanVerdict("Codex Review: Didn't find any major issues."), "explicit clean verdict not recognised");
  assert(!hasExplicitCleanVerdict("Here are some automated review suggestions for this pull request."), "a generic review header is not a clean verdict");
  assert(!hasExplicitCleanVerdict(null), "a missing body is not a clean verdict");

  const thread = (id, oid, extra = {}) => ({ isResolved: false, isOutdated: false, comments: { nodes: [{ databaseId: id, commit: { oid } }] }, ...extra });
  assert(countUnresolvedFindings(null, "abc123") === null, "missing thread evidence must stay unknown, not zero");
  assert(countUnresolvedFindings([], "abc123") === 0, "an empty thread list is zero findings");
  assert(countUnresolvedFindings([thread(1, "abc123")], null) === null, "missing head must stay unknown");
  assert(
    countUnresolvedFindings([thread(1, "abc123"), thread(2, "abc123")], "abc123") === 2,
    "findings from every exact-head thread must be counted, not only the last review's",
  );
  assert(
    countUnresolvedFindings([thread(1, "abc123", { isResolved: true }), thread(2, "abc123")], "abc123") === 1,
    "a resolved thread must not count as an unresolved finding",
  );
  assert(
    countUnresolvedFindings([thread(1, "abc123", { isOutdated: true })], "abc123") === 0,
    "a thread that no longer applies to the current head must not count",
  );
  assert(countUnresolvedFindings([thread(1, "old999")], "abc123") === 0, "a thread anchored to another head must not count");

  const genericCommentedBody = "Codex Review: here are some automated review suggestions for this pull request.";
  assert(!isCleanReviewResult({ state: "COMMENTED", body: genericCommentedBody }, 0), "COMMENTED without an explicit clean verdict must not be treated as clean");
  assert(isCleanReviewResult({ state: "COMMENTED", body: "Didn't find any major issues." }, 0), "COMMENTED with an explicit clean verdict must be clean");
  assert(isCleanReviewResult({ state: "APPROVED", body: "" }, 0), "APPROVED with zero findings must be clean");
  assert(!isCleanReviewResult({ state: "APPROVED", body: "" }, 1), "APPROVED with unresolved findings must not be clean");
  assert(!isCleanReviewResult({ state: "APPROVED", body: "" }, null), "unknown finding evidence must fail closed");
  assert(!isCleanReviewResult({ state: "CHANGES_REQUESTED", body: "Didn't find any major issues." }, 0), "CHANGES_REQUESTED must never be clean");
  assert(!isCleanReviewResult(null, 0), "a missing review must never be clean");

  const cleanCommentAtHead = { body: "Codex Review: Didnt find any major issues. Reviewed commit: abc123def0", created_at: "2026-08-23T09:00:00Z", user: { login: "reviewer-bot" } };
  assert(filterAnchoredCleanComments(comments, "abc123def0aaaa").length === 1, "anchored clean comments must be filtered, not just the last one");
  assert(filterAnchoredCleanComments(null, "abc123") .length === 0, "missing comments filter to an empty list");

  const authorReviewAtHead = { commit: { oid: "abc123def0" }, submitted_at: "2026-08-23T09:01:00Z", state: "COMMENTED", body: "replying on a thread", user: { login: "pr-author" } };
  const changesRequestedAtHead = { commit: { oid: "abc123def0" }, submitted_at: "2026-08-23T08:59:00Z", state: "CHANGES_REQUESTED", body: "blocking", user: { login: "reviewer-bot" } };

  // A clean verdict written by one author must never make another author's review clean.
  const mixedResults = buildAnchoredResults({
    reviews: [changesRequestedAtHead],
    cleanComments: [cleanCommentAtHead],
    headOid: "abc123def0",
    authorLogin: "pr-author",
    unresolvedFindings: 0,
  });
  assert(mixedResults.length === 2, "each published result at the head must be kept separately");
  const changesResult = mixedResults.find((entry) => entry.state === "CHANGES_REQUESTED");
  assert(changesResult.clean === false, "a CHANGES_REQUESTED review must not borrow a clean verdict from a separate comment");
  assert(selectMergeResult(mixedResults).state === "CHANGES_REQUESTED", "a CHANGES_REQUESTED result at the head must block whatever else was published");

  // The author's own review at the head must not become the selected result and stall a
  // genuinely clean independent one.
  const authoredResults = buildAnchoredResults({
    reviews: [authorReviewAtHead],
    cleanComments: [cleanCommentAtHead],
    headOid: "abc123def0",
    authorLogin: "pr-author",
    unresolvedFindings: 0,
  });
  assert(authoredResults.find((entry) => entry.source === "review").independent === false, "the PR author's own review is never independent");
  const selectedClean = selectMergeResult(authoredResults);
  assert(selectedClean.source === "clean_comment" && selectedClean.independent && selectedClean.clean, "an independent clean result must be selected on its own evidence");
  assert(selectedClean.submittedAt === "2026-08-23T09:00:00Z", "the selected result must keep its own timestamp");

  // With unresolved findings outstanding, no result may be clean.
  const withFindings = buildAnchoredResults({
    reviews: [authorReviewAtHead],
    cleanComments: [cleanCommentAtHead],
    headOid: "abc123def0",
    authorLogin: "pr-author",
    unresolvedFindings: 1,
  });
  assert(withFindings.every((entry) => entry.clean === false), "unresolved findings must keep every result unclean");
  assert(selectMergeResult(withFindings).clean === false, "no clean result may be selected while findings are outstanding");
  assert(selectMergeResult([]) === null, "no anchored result selects nothing");

  const pageOf = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));
  assert(collectPagedList(() => pageOf(3), { pageSize: 100 }).length === 3, "a single short page is the complete list");
  assert(collectPagedList(() => [], { pageSize: 100 }).length === 0, "an empty first page is an empty list");
  const twoPages = collectPagedList((page) => (page === 1 ? pageOf(100) : pageOf(7)), { pageSize: 100 });
  assert(twoPages.length === 107, "a full page must be followed by the next page before the list is complete");
  assert(collectPagedList(() => null) === null, "a page that does not arrive as an array is unknown, not empty");
  assert(collectPagedList((page) => (page === 1 ? pageOf(100) : null)) === null, "a failure on a later page must never yield a partial list");
  assert(
    collectPagedList(() => pageOf(100), { pageSize: 100, pageLimit: 3 }) === null,
    "a walk that cannot finish within the page limit is unknown, not the pages already seen",
  );
  assert(collectPagedList(null) === null, "a missing fetcher is unknown");

  // The any-blocker rule only holds if every review page is seen: a CHANGES_REQUESTED
  // review on a later page must still block a clean independent result on page one.
  const blockerOnLaterPage = collectPagedList((page) => (page === 1
    ? [{ commit: { oid: "abc123def0" }, submitted_at: "2026-08-23T08:50:00Z", state: "COMMENTED", body: "Didnt find any major issues.", user: { login: "reviewer-bot" } }, ...pageOf(99)]
    : [{ commit: { oid: "abc123def0" }, submitted_at: "2026-08-23T08:59:00Z", state: "CHANGES_REQUESTED", body: "blocking", user: { login: "other-reviewer" } }]));
  assert(blockerOnLaterPage.length === 101, "every review page must be collected before selection");
  const pagedSelection = selectMergeResult(buildAnchoredResults({
    reviews: blockerOnLaterPage.filter((entry) => entry.commit),
    cleanComments: [],
    headOid: "abc123def0",
    authorLogin: "pr-author",
    unresolvedFindings: 0,
  }));
  assert(pagedSelection.state === "CHANGES_REQUESTED", "a blocking review on a later page must still block the merge result");

  const mergeCi = { headSha: "abc123", status: "completed", conclusion: "success" };
  const publishedCleanReview = {
    commit: { oid: "abc123" },
    submittedAt: "2026-08-23T08:07:00Z",
    independent: true,
    clean: true,
  };
  assert(
    evaluateMergeAllowed({ currentHead: "abc123", ci: mergeCi, requiredGatesGreen: true, review: publishedCleanReview, unresolvedFindings: 0 }).allowed,
    "published clean exact-head review must satisfy the pre-merge gate",
  );
  assert(
    !evaluateMergeAllowed({ currentHead: "abc123", ci: mergeCi, requiredGatesGreen: true, review: { commit: { oid: "abc123" } } }).allowed,
    "a review request without a published result must not satisfy the merge gate",
  );
  assert(
    !evaluateMergeAllowed({ currentHead: "abc123", ci: mergeCi, requiredGatesGreen: true, review: { ...publishedCleanReview, submittedAt: "2026-08-23T08:08:44Z" }, mergeTimestamp: "2026-08-23T08:07:49Z" }).allowed,
    "a review published after merge must not retroactively satisfy the merge gate",
  );
  assert(
    !evaluateMergeAllowed({ currentHead: "abc123", ci: mergeCi, requiredGatesGreen: true, review: { ...publishedCleanReview, commit: { oid: "old999" } } }).allowed,
    "a review for an older head must not satisfy the merge gate",
  );
  assert(
    !evaluateMergeAllowed({ currentHead: "abc123", ci: mergeCi, requiredGatesGreen: true, review: publishedCleanReview, unresolvedFindings: 1 }).allowed,
    "unresolved findings must block the merge gate",
  );
  assert(
    !evaluateMergeAllowed({ currentHead: "abc123", ci: mergeCi, requiredGatesGreen: true, review: publishedCleanReview }).allowed,
    "missing finding evidence must fail closed",
  );
  assert(
    !evaluateMergeAllowed({ currentHead: "abc123", ci: mergeCi, requiredGatesGreen: true, review: { ...publishedCleanReview, independent: false }, unresolvedFindings: 0 }).allowed,
    "the author's own review must not satisfy the independent-review gate",
  );
  assert(
    !evaluateMergeAllowed({ currentHead: "abc123", ci: mergeCi, requiredGatesGreen: true, review: { ...publishedCleanReview, clean: false }, unresolvedFindings: 0 }).allowed,
    "a non-clean review must not satisfy the merge gate",
  );

  const reg = [
    { task: "TASK-09", review_round: 3, finding: "A" },
    { task: "TASK-09", review_round: 3, finding: "A" },
    { task: "TASK-09", review_round: 4, finding: "B" },
    { task: "TASK-09", review_round: 5, finding: "C" },
    { task: "TASK-09", review_round: 6, finding: "D" },
    { task: "TASK-09", review_round: 7, finding: "E", finding_2: "F" },
    { task: "TASK-08", review_round: 9, finding: "Z" },
    { task: "TASK-09", status: "COMPLETED_MERGED" },
  ];
  const sig = evaluateArchitectureComplexitySignal(reg, "TASK-09");
  assert(sig.signal === "ARCHITECTURE_COMPLEXITY_SIGNAL", "signal should fire at five distinct rounds");
  assert(sig.blocking === false, "architecture signal must be non-blocking");
  assert(sig.rounds === 5, `rounds should count distinct review rounds, got ${sig.rounds}`);
  assert(sig.defect_classes.length === 6, "defect classes should be collected and de-duplicated");
  assert(evaluateArchitectureComplexitySignal(reg, "TASK-08").signal === null, "one round must not fire the signal");
  assert(evaluateArchitectureComplexitySignal([...reg, { task: "TASK-09", review_round: 8 }], "TASK-09").rounds === 5, "entries without findings must not change the count");

  const staleState = { current_task: "TASK-09", current_task_status: "READY_TO_START", branch: "feat/TASK-07-sales-model", pr_number: 11, next_action: "START_TASK-09" };
  const staleDrift = detectStateDrift({ state: staleState, git: { branch: "main" }, pr: openPr });
  assert(staleDrift.some((d) => d.code === "TASK_ALREADY_IN_PROGRESS"), "in-progress drift missing");
  assert(staleDrift.some((d) => d.code === "BRANCH_POINTER_STALE"), "branch drift missing");
  assert(staleDrift.some((d) => d.code === "PR_POINTER_STALE"), "PR drift missing");
  assert(staleDrift.some((d) => d.code === "NEXT_ACTION_STALE"), "next-action drift missing");

  const reconciledState = { current_task: "TASK-09", current_task_status: "RECOVERING", branch: "feat/TASK-09-repurchase-forecast", pr_number: 14, next_action: "FIX_TASK_09_BLOCKING_REVIEW_FINDINGS" };
  assert(detectStateDrift({ state: reconciledState, git: { branch: "main" }, pr: openPr }).length === 0, "reconciled state incorrectly flagged");

  const task12State = { current_task: "TASK-12", current_task_status: "NOT_STARTED", next_eligible_task: "TASK-12", mode: "CONTROLLED_AUTONOMOUS", branch: "main", pr_number: "none" };
  const staleHandoff = { current_task: "TASK-11", current_task_status: "NOT_STARTED", next_eligible_task: "TASK-11", mode: "CONTROLLED_AUTONOMOUS", current_branch: "main", current_pr: "none" };
  const handoffDrift = detectStateDrift({ state: task12State, handoff: staleHandoff, git: { branch: "main" }, pr: null });
  assert(handoffDrift.some((d) => d.code === "HANDOFF_CURRENT_TASK_STALE"), "stale HANDOFF current_task must be detected");
  assert(handoffDrift.some((d) => d.code === "HANDOFF_NEXT_ELIGIBLE_STALE"), "stale HANDOFF next_eligible_task must be detected");

  const alignedHandoff = { current_task: "TASK-12", current_task_status: "NOT_STARTED", next_eligible_task: "TASK-12", mode: "CONTROLLED_AUTONOMOUS", current_branch: "main", current_pr: "none" };
  assert(detectStateDrift({ state: task12State, handoff: alignedHandoff, git: { branch: "main" }, pr: null }).length === 0, "aligned STATE/HANDOFF must not drift");

  const populatedVsNone = detectStateDrift({
    state: { ...task12State, pr_number: 17 },
    handoff: { ...alignedHandoff, current_pr: "none" },
    git: { branch: "main" },
    pr: null,
  });
  assert(populatedVsNone.some((d) => d.code === "HANDOFF_PR_STALE"), "STATE populated PR vs HANDOFF none must drift");

  const noneVsPopulated = detectStateDrift({
    state: { ...task12State, pr_number: "none" },
    handoff: { ...alignedHandoff, current_pr: 17 },
    git: { branch: "main" },
    pr: null,
  });
  assert(noneVsPopulated.some((d) => d.code === "HANDOFF_PR_STALE"), "STATE none vs HANDOFF populated PR must drift");

  const advanceDecision = classifyLoopDecision(
    task12State,
    { pending: 6, done: 11, total: 17 },
    { branch: "main", dirty: false },
    null,
    null,
    null,
    { drift: [], taskSpecPresent: false, effectiveTask: "TASK-13", taskSelection: selectedFallback },
  );
  assert(advanceDecision.transition === "TASK_ADVANCE" && advanceDecision.task === "TASK-13", "blocked TASK-12 must advance without owner prompting");

  const task13State = { ...task12State, current_task: "TASK-13", next_eligible_task: "TASK-13" };
  const specDecision = classifyLoopDecision(
    task13State,
    { pending: 6, done: 11, total: 17 },
    { branch: "main", dirty: false },
    null,
    null,
    null,
    { drift: [], taskSpecPresent: false, effectiveTask: "TASK-13", taskSelection: selectedFallback },
  );
  assert(specDecision.transition === "SPEC_REQUIRED" && specDecision.task === "TASK-13", "TASK-13 should require its spec after deterministic selection");

  const preservedNoEligible = resolveEffectiveTask({
    pr: null,
    gitBranch: "main",
    taskSelection: noEligible,
    state: task12State,
    roadmapAvailable: true,
  });
  assert(preservedNoEligible === null, "explicit NO_ELIGIBLE_TASK must not fall back to persisted current_task");

  const fallbackWithoutRoadmap = resolveEffectiveTask({
    pr: null,
    gitBranch: "main",
    taskSelection: { task: "TASK-12", reason: "STATE_FALLBACK", skipped: [] },
    state: task12State,
    roadmapAvailable: false,
  });
  assert(fallbackWithoutRoadmap === "TASK-12", "STATE fallback is allowed only when roadmap resolution is unavailable");

  const blockedDecision = classifyLoopDecision(
    task12State,
    { pending: 2, done: 11, total: 13 },
    { branch: "main", dirty: false },
    null,
    null,
    null,
    { drift: [], taskSpecPresent: true, effectiveTask: preservedNoEligible, taskSelection: noEligible },
  );
  assert(blockedDecision.transition === "NO_ELIGIBLE_TASK", "all-blocked roadmap must expose no eligible work even when persisted task spec exists");

  const reviewPr = { ...openPr, headRefOid: "abc123" };
  const cleanDecision = classifyLoopDecision(
    task13State,
    { pending: 1, done: 12, total: 13 },
    { branch: "main", dirty: false },
    reviewPr,
    { anchored: publishedCleanReview, unresolvedFindings: 0 },
    { databaseId: 99, headSha: "abc123", status: "completed", conclusion: "success" },
    { drift: [], taskSpecPresent: true, effectiveTask: "TASK-13", taskSelection: selectedFallback, requiredGatesGreen: true, unresolvedFindings: 0 },
  );
  assert(cleanDecision.transition === "READY_TO_MERGE", "the executable controller path must expose READY_TO_MERGE only after all gates pass");

  const genericCommentedReview = {
    commit: { oid: "abc123" },
    submittedAt: "2026-08-23T14:13:51Z",
    independent: true,
    state: "COMMENTED",
    body: genericCommentedBody,
  };
  const genericDecision = classifyLoopDecision(
    task13State,
    { pending: 1, done: 12, total: 13 },
    { branch: "main", dirty: false },
    reviewPr,
    { anchored: { ...genericCommentedReview, clean: isCleanReviewResult(genericCommentedReview, 0) }, unresolvedFindings: 0 },
    { databaseId: 99, headSha: "abc123", status: "completed", conclusion: "success" },
    { drift: [], taskSpecPresent: true, effectiveTask: "TASK-13", taskSelection: selectedFallback, requiredGatesGreen: true, unresolvedFindings: 0 },
  );
  assert(genericDecision.transition !== "READY_TO_MERGE", "a COMMENTED review with no clean verdict must never reach READY_TO_MERGE");
  assert(genericDecision.transition === "WAIT_FOR_CODEX", "a published review without a clean result must keep waiting for an independent clean result");

  const findingDecision = classifyLoopDecision(
    task13State,
    { pending: 1, done: 12, total: 13 },
    { branch: "main", dirty: false },
    reviewPr,
    { anchored: { ...publishedCleanReview, clean: false }, unresolvedFindings: 1 },
    { databaseId: 99, headSha: "abc123", status: "completed", conclusion: "success" },
    { drift: [], taskSpecPresent: true, effectiveTask: "TASK-13", taskSelection: selectedFallback, requiredGatesGreen: true, unresolvedFindings: 1 },
  );
  assert(findingDecision.transition === "RECOVERABLE_FAILURE", "the executable controller path must route findings to recovery");

  // A PR whose branch names no task is governance work. Its gates must be evaluated on its
  // own terms; it must never inherit the next roadmap task's spec requirement and be
  // advanced past while still unresolved.
  const governancePr = { number: 24, state: "OPEN", headRefName: "fix/loop-transient-wait-reentry", headRefOid: "abc123" };
  const governanceDecision = classifyLoopDecision(
    task13State,
    { pending: 1, done: 12, total: 13 },
    { branch: "fix/loop-transient-wait-reentry", dirty: false },
    governancePr,
    null,
    { databaseId: 99, headSha: "abc123", status: "completed", conclusion: "success" },
    { drift: [], taskSpecPresent: false, effectiveTask: "TASK-12", taskSelection: selectedFallback, requiredGatesGreen: true, unresolvedFindings: 0 },
  );
  assert(governanceDecision.transition === "WAIT_FOR_CODEX", "an unresolved governance PR must reach its own review gate, not SPEC_REQUIRED for the next task");
  assert(governanceDecision.pr_context === "GOVERNANCE_PR" && governanceDecision.pr_number === 24, "a governance decision must name the PR it is about");

  const taskPrDecision = classifyLoopDecision(
    task13State,
    { pending: 1, done: 12, total: 13 },
    { branch: "feat/TASK-12-repurchase-dashboard", dirty: false },
    { number: 25, state: "OPEN", headRefName: "feat/TASK-12-repurchase-dashboard", headRefOid: "abc123" },
    null,
    { databaseId: 99, headSha: "abc123", status: "completed", conclusion: "success" },
    { drift: [], taskSpecPresent: false, effectiveTask: "TASK-12", taskSelection: selectedFallback, requiredGatesGreen: true, unresolvedFindings: 0 },
  );
  assert(taskPrDecision.transition === "SPEC_REQUIRED", "a task PR without its spec must still be SPEC_REQUIRED");
  assert(taskPrDecision.pr_number === 25 && taskPrDecision.pr_context === "TASK_PR", "SPEC_REQUIRED for an open task PR must still name its PR and context");

  const mergedGovernanceDecision = classifyLoopDecision(
    task13State,
    { pending: 1, done: 12, total: 13 },
    { branch: "fix/loop-transient-wait-reentry", dirty: false },
    { ...governancePr, state: "MERGED" },
    null,
    { databaseId: 99, headSha: "abc123", status: "completed", conclusion: "success" },
    { drift: [], taskSpecPresent: false, effectiveTask: "TASK-12", taskSelection: selectedFallback, requiredGatesGreen: true, unresolvedFindings: 0 },
  );
  assert(mergedGovernanceDecision.transition === "POST_MERGE_VALIDATION", "a merged governance PR must reach post-merge validation, not the next task spec gate");
  assert(mergedGovernanceDecision.pr_context === "GOVERNANCE_PR", "governance context must survive the PR being merged");
  assert(cleanDecision.pr_context === "TASK_PR", "a task PR decision must be labelled as task work");

  // FINDING TRANSIENT_WAIT_NO_REENTRY: a WAIT_* state is an external timing fact, never an
  // outcome, and must never end an autonomous run while executable work remains.
  for (const waitTransition of WAIT_TRANSITIONS) {
    assert(isWaitTransition(waitTransition), waitTransition + " must be recognised as a wait");
    assert(!isTerminalTransition(waitTransition), waitTransition + " must never be a terminal transition");
    assert(!TERMINAL_TRANSITIONS.includes(waitTransition), waitTransition + " must not appear in TERMINAL_TRANSITIONS");
  }
  assert(isTerminalTransition("ROADMAP_COMPLETE"), "a finished roadmap is a legitimate stop");
  assert(isTerminalTransition("BLOCKED_EXTERNAL"), "a proven external blocker is a legitimate stop");
  assert(isTerminalTransition("OWNER_DECISION"), "an owner decision is a legitimate stop");
  assert(!isTerminalTransition("SPEC_REQUIRED"), "SPEC_REQUIRED means write the spec, not stop the loop");
  assert(!isTerminalTransition("READY_TO_MERGE"), "READY_TO_MERGE must continue into the merge");
  assert(!isTerminalTransition("RECOVERABLE_FAILURE"), "a recoverable failure must continue into recovery");
  assert(!isTerminalTransition("POST_MERGE_VALIDATION"), "post-merge validation must continue");
  assert(!isTerminalTransition("STATE_DRIFT_DETECTED"), "drift is reconcilable by the loop itself");

  const waitT0 = new Date("2026-08-11T10:00:00.000Z");
  const freshWait = startWait({ state: "WAIT_FOR_CODEX", task: "TASK-12", prNumber: 24, targetHead: "abc123", now: waitT0 });
  assert(evaluateWaitEscalation(null).status === "CONTINUE", "no persisted wait is not an escalation");
  assert(evaluateWaitEscalation(freshWait).status === "CONTINUE", "a fresh wait must keep polling");
  assert(evaluateWaitEscalation({ ...freshWait, poll_count: MAX_WAIT_POLLS - 1 }).status === "CONTINUE", "a wait below the poll budget must keep polling");
  const escalated = evaluateWaitEscalation({ ...freshWait, poll_count: MAX_WAIT_POLLS, last_error: "codex offline" });
  assert(escalated.status === "BLOCKED_EXTERNAL", "an exhausted wait budget must escalate, not spin or stop silently");
  assert(escalated.evidence.target_head === "abc123" && escalated.evidence.pr_number === 24, "an escalation must carry exact evidence");
  assert(escalated.evidence.last_error === "codex offline", "an escalation must carry the last observed error");

  const waitingReentry = describeReentry({ decision: { transition: "WAIT_FOR_CODEX" }, runtime: freshWait });
  assert(waitingReentry.terminal === false && waitingReentry.must_reenter === true, "a pending review must re-enter the controller, never end the run");
  assert(waitingReentry.wait_state.target_head === "abc123", "a resumable wait must name the exact head it is waiting on");

  const unpersisted = describeReentry({ decision: { transition: "WAIT_FOR_CI" }, runtime: null });
  assert(unpersisted.must_reenter === true, "an unpersisted wait still must re-enter");
  assert(unpersisted.wait_state_missing === true, "an unpersisted wait must be reported so recovery is deterministic");
  assert(typeof unpersisted.persist_command === "string" && unpersisted.persist_command.includes("wait start"), "an unpersisted wait must name how to persist itself");

  const spentBudget = describeReentry({ decision: { transition: "WAIT_FOR_CODEX" }, runtime: { ...freshWait, poll_count: MAX_WAIT_POLLS } });
  assert(spentBudget.terminal === false && spentBudget.must_reenter === true, "describeReentry must read terminality from the decision, never re-derive it from the budget");
  assert(spentBudget.escalation_required === true, "a spent budget on an unpromoted decision must ask the caller to promote it");
  assert(spentBudget.poll_budget.exhausted === true && spentBudget.poll_budget.max_polls === MAX_WAIT_POLLS, "the poll budget must be reported for observability");
  const spentThenPromoted = applyWaitEscalation({ transition: "WAIT_FOR_CODEX" }, { ...freshWait, poll_count: MAX_WAIT_POLLS });
  assert(spentThenPromoted.transition === "BLOCKED_EXTERNAL", "applyWaitEscalation is the only thing that may end a wait");
  assert(describeReentry({ decision: spentThenPromoted }).terminal === true, "once promoted, the decision alone makes the run terminal");

  // FINDING API_CONNECTION_LOSS_NO_REENTRY: an interruption can land between creating the
  // external dependency and persisting the wait for it, so recovery must reconstruct the
  // wait from repository facts alone and never depend on .rick/tmp surviving.
  const openPrFacts = { number: 24, headRefOid: "7a6dadb", state: "OPEN" };
  const rebuilt = reconstructWaitFromFacts({ decision: { transition: "WAIT_FOR_CODEX" }, pr: openPrFacts, task: "LOOP-GOVERNANCE" });
  assert(rebuilt.state === "WAIT_FOR_CODEX" && rebuilt.pr_number === 24 && rebuilt.target_head === "7a6dadb", "a wait must be reconstructible from the open PR alone");
  assert(rebuilt.derived_from === "repository_facts", "a reconstructed wait must declare that it came from repository facts");
  assert(reconstructWaitFromFacts({ decision: { transition: "WAIT_FOR_CODEX" }, pr: null }) === null, "no PR means no wait to reconstruct");
  assert(reconstructWaitFromFacts({ decision: { transition: "READY_TO_MERGE" }, pr: openPrFacts }) === null, "a non-wait transition reconstructs no wait");

  const statelessRecovery = describeReentry({
    decision: { transition: "WAIT_FOR_CODEX" },
    runtime: null,
    pr: openPrFacts,
    task: "LOOP-GOVERNANCE",
    executorBridge: "SCHEDULE_WAKEUP",
  });
  assert(statelessRecovery.must_reenter === true, "a lost connection must not turn a wait into a stop");
  assert(statelessRecovery.wait_state_missing === false, "recovery must not depend on .rick/tmp surviving the interruption");
  assert(statelessRecovery.wait_state.target_head === "7a6dadb", "the reconstructed wait must name the exact head");
  assert(statelessRecovery.trigger_required === true && statelessRecovery.executor_bridge === "SCHEDULE_WAKEUP", "a non-terminal decision must report that a re-entry trigger is owed and which bridge owes it");

  const persistedWins = describeReentry({
    decision: { transition: "WAIT_FOR_CODEX" },
    runtime: { ...freshWait, task: "LOOP-GOVERNANCE", target_head: "7a6dadb", poll_count: 3 },
    pr: openPrFacts,
    task: "LOOP-GOVERNANCE",
  });
  assert(persistedWins.wait_state.derived_from === "runtime_state" && persistedWins.wait_state.poll_count === 3, "a persisted wait must be preferred over reconstruction");

  const noFacts = describeReentry({ decision: { transition: "WAIT_FOR_CI" }, runtime: null, pr: null });
  assert(noFacts.wait_state_missing === true && typeof noFacts.persist_command === "string", "with neither runtime nor PR facts the wait is genuinely missing and must say how to persist one");

  // A runtime checkpoint that belongs to an earlier wait must never contribute its poll
  // budget: an exhausted checkpoint for one task would otherwise strand a fresh wait for
  // another, carrying the wrong PR and head as its evidence.
  const currentWait = { transition: "WAIT_FOR_CODEX", task: "LOOP-GOVERNANCE", pr: openPrFacts };
  assert(waitMatchesDecision(null, currentWait) === false, "no checkpoint never matches");
  assert(waitMatchesDecision({ state: "WAIT_FOR_CODEX", task: "LOOP-GOVERNANCE", pr_number: 24, target_head: "7a6dadb" }, currentWait), "a checkpoint about the same wait must match");
  assert(!waitMatchesDecision({ state: "WAIT_FOR_CI", task: "LOOP-GOVERNANCE", pr_number: 24, target_head: "7a6dadb" }, currentWait), "a checkpoint for another transition must not match");
  assert(!waitMatchesDecision({ state: "WAIT_FOR_CODEX", task: "TASK-11", pr_number: 24, target_head: "7a6dadb" }, currentWait), "a checkpoint for another task must not match");
  assert(!waitMatchesDecision({ state: "WAIT_FOR_CODEX", task: "LOOP-GOVERNANCE", pr_number: 17, target_head: "7a6dadb" }, currentWait), "a checkpoint for another PR must not match");
  assert(!waitMatchesDecision({ state: "WAIT_FOR_CODEX", task: "LOOP-GOVERNANCE", pr_number: 24, target_head: "old999" }, currentWait), "a checkpoint for another head must not match");

  assert(
    !waitMatchesDecision({ state: "WAIT_FOR_CODEX", task: "LOOP-GOVERNANCE", pr_number: null, target_head: null }, currentWait),
    "a checkpoint that identifies no PR or head must not be adopted by the current wait",
  );
  assert(
    !waitMatchesDecision({ state: "WAIT_FOR_CODEX", pr_number: 24, target_head: "7a6dadb" }, currentWait),
    "a checkpoint with no task must not match a wait that names one",
  );
  const anonymousExhausted = { state: "WAIT_FOR_CI", task: "TASK-12", pr_number: null, target_head: null, poll_count: MAX_WAIT_POLLS };
  assert(
    applyWaitEscalation({ transition: "WAIT_FOR_CI" }, anonymousExhausted, { task: "TASK-12", pr: openPrFacts }).transition === "WAIT_FOR_CI",
    "an exhausted checkpoint that identifies no PR must never promote a different wait to BLOCKED_EXTERNAL",
  );

  const staleExhausted = { state: "WAIT_FOR_CODEX", task: "TASK-11", pr_number: 17, target_head: "old999", poll_count: MAX_WAIT_POLLS };
  const staleIgnored = describeReentry({
    decision: { transition: "WAIT_FOR_CODEX" },
    runtime: staleExhausted,
    pr: openPrFacts,
    task: "LOOP-GOVERNANCE",
  });
  assert(staleIgnored.terminal === false && staleIgnored.must_reenter === true, "an exhausted checkpoint for another wait must never strand the current one");
  assert(staleIgnored.stale_wait_ignored === true, "ignoring a stale checkpoint must be reported");
  assert(staleIgnored.wait_state.derived_from === "repository_facts" && staleIgnored.wait_state.pr_number === 24, "the current wait must be rebuilt from facts, not from the stale checkpoint");

  // An exhausted wait must become the decision itself: decision and reentry can never
  // disagree about whether the run may end.
  const waitDecision = { transition: "WAIT_FOR_CODEX", reason: "awaiting review", terminal: false };
  const matchedExhausted = { state: "WAIT_FOR_CODEX", task: "LOOP-GOVERNANCE", pr_number: 24, target_head: "7a6dadb", poll_count: MAX_WAIT_POLLS, started_at: "2026-08-23T15:00:00Z", last_error: null };
  const promoted = applyWaitEscalation(waitDecision, matchedExhausted, { task: "LOOP-GOVERNANCE", pr: openPrFacts });
  assert(promoted.transition === "BLOCKED_EXTERNAL" && promoted.terminal === true, "an exhausted wait must be promoted to a BLOCKED_EXTERNAL decision");
  assert(promoted.waited_transition === "WAIT_FOR_CODEX" && promoted.evidence.target_head === "7a6dadb", "the promoted decision must carry the wait it replaced and its evidence");
  const promotedReentry = describeReentry({ decision: promoted, runtime: matchedExhausted, pr: openPrFacts, task: "LOOP-GOVERNANCE" });
  assert(promotedReentry.terminal === promoted.terminal, "decision and reentry must never disagree about terminality");
  assert(promotedReentry.waiting === false && promotedReentry.poll_budget === null, "a promoted decision is no longer a wait");
  assert(promotedReentry.escalation_required === false, "a promoted decision needs no further escalation");
  assert(applyWaitEscalation(waitDecision, { ...matchedExhausted, poll_count: 1 }, { task: "LOOP-GOVERNANCE", pr: openPrFacts }).transition === "WAIT_FOR_CODEX", "a wait below budget must not be promoted");
  assert(applyWaitEscalation(waitDecision, staleExhausted, { task: "LOOP-GOVERNANCE", pr: openPrFacts }).transition === "WAIT_FOR_CODEX", "a stale exhausted checkpoint must not promote the current wait");
  assert(applyWaitEscalation({ transition: "READY_TO_MERGE" }, matchedExhausted, { task: "LOOP-GOVERNANCE", pr: openPrFacts }).transition === "READY_TO_MERGE", "a non-wait decision is never promoted");

  const completeReentry = describeReentry({ decision: { transition: "ROADMAP_COMPLETE" }, runtime: null });
  assert(completeReentry.terminal === true && completeReentry.waiting === false, "a finished roadmap ends the run without waiting");

  assert(cleanDecision.terminal === false, "READY_TO_MERGE from the controller must not be terminal");
  assert(genericDecision.terminal === false, "a WAIT_FOR_CODEX decision from the controller must not be terminal");
  assert(findingDecision.terminal === false, "a RECOVERABLE_FAILURE decision from the controller must not be terminal");
  assert(specDecision.terminal === false, "a SPEC_REQUIRED decision from the controller must not be terminal");

  assert(backoffSecondsForPollCount(0) === 30, "first backoff wrong");
  assert(backoffSecondsForPollCount(2) === 60, "third backoff wrong");
  assert(backoffSecondsForPollCount(100) === 600, "backoff cap wrong");
  for (let i = 1; i < WAIT_BACKOFF_SECONDS.length; i += 1) assert(WAIT_BACKOFF_SECONDS[i] >= WAIT_BACKOFF_SECONDS[i - 1], "backoff must be non-decreasing");

  const t0 = new Date("2026-08-11T10:00:00.000Z");
  const wait0 = startWait({ state: "WAIT_FOR_CODEX", task: "TASK-09", prNumber: 14, targetHead: "abc123", now: t0 });
  const wait1 = recordPoll(wait0, { resolved: false, now: new Date(t0.getTime() + 30_000) });
  assert(wait1.poll_count === 1 && wait1.stagnant_attempt === 0, "wait poll semantics wrong");
  assert(recordPoll(wait1, { resolved: true }) === null, "resolved wait must clear");

  assert(nextStagnationState(2, { progressed: false, max: 3 }).status === "HUMAN_REQUIRED", "third stagnant attempt must stop");
  assert(nextStagnationState(2, { progressed: true, max: 3 }).stagnant_attempt === 0, "real progress must reset stagnation");

  const intentA = startPrewrite({ task: "TASK-09", action: "fix-review-findings", expectedState: "VALIDATING", targetHead: "abc123", now: t0 });
  const intentB = startPrewrite({ task: "TASK-09", action: "fix-review-findings", expectedState: "VALIDATING", targetHead: "abc123", now: new Date(t0.getTime() + 1000) });
  assert(intentA.idempotency_key === prewriteKey({ task: "TASK-09", action: "fix-review-findings", expectedState: "VALIDATING", targetHead: "abc123" }), "prewrite key mismatch");
  assert(samePrewriteIntent(intentA, intentB), "same intent must be idempotent");
  assert(!samePrewriteIntent(intentA, startPrewrite({ task: "TASK-09", action: "merge" })), "different intent must not reuse key");
  const completed = completePrewrite(intentA, { resultState: "VALIDATING", now: new Date(t0.getTime() + 2000) });
  assert(completed.result_state === "VALIDATING" && completed.completed_at, "prewrite completion wrong");

  const tmpDir = mkdtempSync(join(tmpdir(), "rick-loop-controller-check-"));
  const runtimePath = join(tmpDir, "loop-runtime.json");
  const prewritePath = join(tmpDir, "prewrite.json");
  try {
    assert(loadRuntimeState(runtimePath) === null, "missing runtime must be null");
    saveRuntimeState(wait1, runtimePath);
    assert(existsSync(runtimePath), "runtime save failed");
    assert(readdirSync(tmpDir).length === 1, "runtime atomic save left temp file");
    assert(loadRuntimeState(runtimePath).target_head === "abc123", "runtime reload lost target head");
    saveRuntimeState(null, runtimePath);
    assert(!existsSync(runtimePath), "runtime clear failed");
    savePrewriteState(intentA, prewritePath);
    assert(loadPrewriteState(prewritePath).idempotency_key === intentA.idempotency_key, "prewrite reload failed");
    assert(readdirSync(tmpDir).length === 1, "prewrite atomic save left temp file");
    savePrewriteState(null, prewritePath);
    assert(!existsSync(prewritePath), "prewrite clear failed");
  } finally { rmSync(tmpDir, { recursive: true, force: true }); }

  console.log("Rick Loop controller v1.3.3 tests: PASS");
} catch (error) {
  console.error("Rick Loop controller v1.3.3 tests: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
