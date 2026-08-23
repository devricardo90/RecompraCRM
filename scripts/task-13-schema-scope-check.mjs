import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";

const baseline = "2995589c88ea7ab46781b59ba273b440eb2eebdd";
const committed = execFileSync("git", ["diff", "--name-only", `${baseline}..HEAD`], { encoding: "utf8" })
  .split(/\r?\n/u)
  .filter(Boolean);
const worktree = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { encoding: "utf8" })
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((line) => line.slice(3).trim());
const changed = [...new Set([...committed, ...worktree])];
const forbidden = changed.filter((path) => path === "prisma/schema.prisma" || path.startsWith("prisma/migrations/"));

assert.deepEqual(forbidden, [], `TASK-13 changed schema/migration paths: ${forbidden.join(", ")}`);
console.log(`TASK-13 schema scope check: PASS (${changed.length} changed paths inspected)`);
