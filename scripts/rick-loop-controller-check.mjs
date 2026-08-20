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
  evaluateArchitectureComplexitySignal,
  detectStateDrift,
  parseRoadmapPlan,
  resolveNextEligibleTask,
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

  const blockedDecision = classifyLoopDecision(
    task12State,
    { pending: 2, done: 11, total: 13 },
    { branch: "main", dirty: false },
    null,
    null,
    null,
    { drift: [], taskSpecPresent: false, effectiveTask: null, taskSelection: noEligible },
  );
  assert(blockedDecision.transition === "NO_ELIGIBLE_TASK", "all-blocked roadmap must expose no eligible work rather than invent owner approval");

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

  console.log("Rick Loop controller v1.3.2 tests: PASS");
} catch (error) {
  console.error("Rick Loop controller v1.3.2 tests: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
