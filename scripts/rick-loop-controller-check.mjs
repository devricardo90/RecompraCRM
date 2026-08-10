import { parseFlatYaml, countRoadmapTasks, classifyDocsOnlyDiff } from "./rick-loop-controller.mjs";

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

  console.log("Rick Loop controller tests: PASS");
} catch (error) {
  console.error("Rick Loop controller tests: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
