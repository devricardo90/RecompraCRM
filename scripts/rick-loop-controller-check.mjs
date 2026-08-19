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
  detectStateDrift,
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

  assert(CANONICAL_TASK_STATES.includes("RECOVERING"), "canonical task states missing RECOVERING");
  assert(taskFromBranch("feat/TASK-09-repurchase-forecast") === "TASK-09", "task branch parse failed");
  assert(taskFromBranch("main") === null, "main must not parse as task branch");

  const openPr = { number: 14, state: "OPEN", headRefName: "feat/TASK-09-repurchase-forecast", headRefOid: "abc123" };
  const greenCi = { status: "completed", conclusion: "success" };
  const currentReview = { headRefOid: "abc123", lastReview: { submittedAt: "now" } };
  assert(deriveCanonicalTaskState({ git: { branch: "main" }, pr: null, review: null, ci: null }) === "READY", "main/no PR should be READY");
  assert(deriveCanonicalTaskState({ git: { branch: "feat/TASK-09-x" }, pr: null, review: null, ci: null }) === "IMPLEMENTING", "task branch/no PR should be IMPLEMENTING");
  assert(deriveCanonicalTaskState({ git: {}, pr: openPr, review: null, ci: null }) === "WAIT_CI", "open PR/no CI should WAIT_CI");
  assert(deriveCanonicalTaskState({ git: {}, pr: openPr, review: null, ci: greenCi }) === "WAIT_REVIEW", "green CI/no review should WAIT_REVIEW");
  assert(deriveCanonicalTaskState({ git: {}, pr: openPr, review: currentReview, ci: greenCi }) === "REVIEW_LANDED", "current review should land");

  const staleState = { current_task: "TASK-09", current_task_status: "READY_TO_START", branch: "feat/TASK-07-sales-model", pr_number: 11, next_action: "START_TASK-09" };
  const staleDrift = detectStateDrift({ state: staleState, git: { branch: "main" }, pr: openPr });
  assert(staleDrift.some((d) => d.code === "TASK_ALREADY_IN_PROGRESS"), "in-progress drift missing");
  assert(staleDrift.some((d) => d.code === "BRANCH_POINTER_STALE"), "branch drift missing");
  assert(staleDrift.some((d) => d.code === "PR_POINTER_STALE"), "PR drift missing");
  assert(staleDrift.some((d) => d.code === "NEXT_ACTION_STALE"), "next-action drift missing");

  const reconciledState = { current_task: "TASK-09", current_task_status: "RECOVERING", branch: "feat/TASK-09-repurchase-forecast", pr_number: 14, next_action: "FIX_TASK_09_BLOCKING_REVIEW_FINDINGS" };
  assert(detectStateDrift({ state: reconciledState, git: { branch: "main" }, pr: openPr }).length === 0, "reconciled state incorrectly flagged");

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

  console.log("Rick Loop controller v1.3 tests: PASS");
} catch (error) {
  console.error("Rick Loop controller v1.3 tests: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
