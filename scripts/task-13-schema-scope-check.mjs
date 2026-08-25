import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";

/**
 * TASK-13 introduced no schema change and no migration.
 *
 * The check is pinned to TASK-13's own merged range. It used to compare the
 * baseline against HEAD and the working tree, which asserted that *no* schema
 * change ever happens again in this repository — that blocked TASK-12's
 * approved additive index rather than guarding TASK-13. TASK-13 is merged, so
 * its range is fixed and the property it proves is permanent.
 */
const baseline = "2995589c88ea7ab46781b59ba273b440eb2eebdd";
const task13MergeHead = "e36710799d8423752bed8b3e8ec4edd18191ef26";

const changed = execFileSync("git", ["diff", "--name-only", `${baseline}..${task13MergeHead}`], {
  encoding: "utf8",
})
  .split(/\r?\n/u)
  .filter(Boolean);

const forbidden = changed.filter(
  (path) => path === "prisma/schema.prisma" || path.startsWith("prisma/migrations/"),
);

assert.deepEqual(forbidden, [], `TASK-13 changed schema/migration paths: ${forbidden.join(", ")}`);
console.log(`TASK-13 schema scope check: PASS (${changed.length} changed paths inspected)`);
