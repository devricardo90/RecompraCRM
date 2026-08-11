import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseFlatYaml,
  countRoadmapTasks,
  classifyDocsOnlyDiff,
  WAIT_BACKOFF_SECONDS,
  backoffSecondsForPollCount,
  startWait,
  recordPoll,
  loadRuntimeState,
  saveRuntimeState,
} from "./rick-loop-controller.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  // parseFlatYaml: scalars, quoted strings, booleans, numbers, lists.
  const parsed = parseFlatYaml(`
\`\`\`yaml
mode: CONTROLLED_AUTONOMOUS
attempt: 7
next_action_authorized: true
updated_at: "2026-08-10T18:22:00Z"
completed_tasks:
  - TASK-01
  - TASK-02
\`\`\`
`);
  assert(parsed.mode === "CONTROLLED_AUTONOMOUS", "flat scalar not parsed");
  assert(parsed.attempt === 7, "numeric value not parsed as number");
  assert(parsed.next_action_authorized === true, "boolean value not parsed");
  assert(parsed.updated_at === "2026-08-10T18:22:00Z", "quoted string not unquoted");
  assert(Array.isArray(parsed.completed_tasks) && parsed.completed_tasks.length === 2, "list not parsed");
  assert(parsed.completed_tasks[1] === "TASK-02", "list item value wrong");

  // countRoadmapTasks: pending vs done TASK- checkboxes.
  const roadmap = countRoadmapTasks(`
- [x] TASK-01 — done
- [x] TASK-02 — done
- [ ] TASK-03 — pending
- [ ] TASK-04 — pending
- [ ] TASK-05 — pending
`);
  assert(roadmap.done === 2, "done count wrong");
  assert(roadmap.pending === 3, "pending count wrong");
  assert(roadmap.total === 5, "total count wrong");

  const complete = countRoadmapTasks("- [x] TASK-01 — done\n- [x] TASK-02 — done\n");
  assert(complete.pending === 0 && complete.total === 2, "fully-complete roadmap not detected");

  // classifyDocsOnlyDiff: the allowlist that gates REVIEW_CARRY_FORWARD.
  assert(
    classifyDocsOnlyDiff(["docs/operations/STATE.md", "docs/operations/HANDOFF.md"]) === true,
    "allowlisted docs-only diff misclassified",
  );
  assert(
    classifyDocsOnlyDiff(["docs/evidence/TASK-08-validation.md"]) === true,
    "evidence glob misclassified",
  );
  assert(
    classifyDocsOnlyDiff(["docs/operations/STATE.md", "prisma/schema.prisma"]) === false,
    "code file did not disqualify carry-forward",
  );
  assert(
    classifyDocsOnlyDiff(["package.json"]) === false,
    "non-docs file misclassified as docs-only",
  );
  assert(classifyDocsOnlyDiff([]) === false, "empty diff must not be treated as docs-only");

  // backoffSecondsForPollCount: bounded 30/30/60/60/120/300/600, capped.
  assert(backoffSecondsForPollCount(0) === 30, "first backoff wrong");
  assert(backoffSecondsForPollCount(1) === 30, "second backoff wrong");
  assert(backoffSecondsForPollCount(2) === 60, "third backoff wrong");
  assert(backoffSecondsForPollCount(6) === 600, "cap value wrong");
  assert(backoffSecondsForPollCount(100) === 600, "backoff did not stay bounded past the cap");
  assert(backoffSecondsForPollCount(-1) === 30, "negative poll count not clamped");
  for (let i = 1; i < WAIT_BACKOFF_SECONDS.length; i += 1) {
    assert(WAIT_BACKOFF_SECONDS[i] >= WAIT_BACKOFF_SECONDS[i - 1], "backoff sequence must be non-decreasing");
  }

  // startWait / recordPoll: pure wait-state transitions (no real time, no I/O).
  const t0 = new Date("2026-08-11T10:00:00.000Z");
  const wait0 = startWait({ state: "WAIT_FOR_CODEX", task: "TASK-09", prNumber: 13, targetHead: "abc123", now: t0 });
  assert(wait0.poll_count === 0, "initial poll_count must be 0");
  assert(wait0.backoff_seconds === 30, "initial backoff must be the first sequence value");
  assert(wait0.next_poll_at === new Date(t0.getTime() + 30_000).toISOString(), "initial next_poll_at wrong");
  assert(wait0.stagnant_attempt === 0, "initial stagnant_attempt must be 0");

  const t1 = new Date(t0.getTime() + 30_000);
  const wait1 = recordPoll(wait0, { resolved: false, now: t1 });
  assert(wait1.poll_count === 1, "pending poll must increment poll_count");
  assert(wait1.backoff_seconds === 30, "second poll backoff wrong");
  assert(wait1.task === "TASK-09" && wait1.pr_number === 13, "pending poll must preserve task/pr identity");
  assert(wait1.stagnant_attempt === 0, "waiting must never increment stagnant_attempt");

  const t2 = new Date(t1.getTime() + 30_000);
  const wait2 = recordPoll(wait1, { resolved: false, now: t2 });
  assert(wait2.poll_count === 2, "third poll must increment poll_count again");
  assert(wait2.backoff_seconds === 60, "third poll backoff wrong");
  assert(wait2.stagnant_attempt === 0, "waiting must never increment stagnant_attempt (poll 2)");

  const resolved = recordPoll(wait2, { resolved: true, now: new Date(t2.getTime() + 60_000) });
  assert(resolved === null, "a resolved poll must clear the wait state");

  // loadRuntimeState / saveRuntimeState: persistence round-trip through a
  // real temp file, proving process-restart resume works without touching
  // the repo's actual .rick/tmp runtime file.
  const tmpDir = mkdtempSync(join(tmpdir(), "rick-loop-controller-check-"));
  const runtimePath = join(tmpDir, "loop-runtime.json");
  try {
    assert(loadRuntimeState(runtimePath) === null, "loading a nonexistent runtime file must return null");

    saveRuntimeState(wait1, runtimePath);
    assert(existsSync(runtimePath), "saveRuntimeState must create the runtime file");
    assert(
      readdirSync(tmpDir).length === 1,
      "saveRuntimeState must leave no temp file behind after the atomic rename",
    );
    const reloaded = loadRuntimeState(runtimePath);
    assert(reloaded.poll_count === wait1.poll_count, "reloaded runtime state lost poll_count");
    assert(reloaded.next_poll_at === wait1.next_poll_at, "reloaded runtime state lost next_poll_at");
    assert(reloaded.target_head === "abc123", "reloaded runtime state lost target_head");

    // Simulate a second wakeup cycle after "process restart": load, poll
    // again as pending, save, reload.
    const reloadedPending = recordPoll(reloaded, { resolved: false, now: new Date(t2.getTime() + 60_000) });
    saveRuntimeState(reloadedPending, runtimePath);
    const afterSecondWakeup = loadRuntimeState(runtimePath);
    assert(afterSecondWakeup.poll_count === 2, "resumed wait must continue incrementing poll_count across restarts");

    // Third wakeup: the external result finally lands.
    const finalPoll = recordPoll(afterSecondWakeup, { resolved: true });
    saveRuntimeState(finalPoll, runtimePath);
    assert(!existsSync(runtimePath), "a resolved wait must clear the persisted runtime file");
    assert(loadRuntimeState(runtimePath) === null, "runtime state must read back as null after resolution");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log("Rick Loop controller tests: PASS");
} catch (error) {
  console.error("Rick Loop controller tests: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
