import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { classifyLeak, evaluateRevision } from "./remote-smoke-check.mjs";

/**
 * TASK-16: proves the two guards by exercising them, including the cases they
 * must reject. A guard is only worth its place in CI if something demonstrates
 * it can fail; one that has only ever passed is indistinguishable from one
 * that cannot fail.
 */

// --- revision verification -------------------------------------------------
//
// The reason this check exists: every route check in the smoke passes
// identically against a deployment that failed and left the previous revision
// serving. Without comparing revisions, "smoke remoto aprovado" can be
// satisfied by old code.
{
  assert.equal(
    evaluateRevision({ served: "abc123", expected: "abc123" }).ok,
    true,
    "matching revisions pass",
  );

  const stale = evaluateRevision({ served: "oldsha", expected: "newsha" });
  assert.equal(stale.ok, false, "a stale revision must fail");
  assert.ok(
    stale.reason.includes("oldsha") && stale.reason.includes("newsha"),
    `the reason must name both revisions, got: ${stale.reason}`,
  );

  const absent = evaluateRevision({ served: null, expected: "newsha" });
  assert.equal(absent.ok, false, "an absent revision must fail when one was expected");

  assert.equal(
    evaluateRevision({ served: null, expected: null }).ok,
    true,
    "with no expected revision the check is skipped, which is correct locally",
  );
}

// --- leak detection --------------------------------------------------------
{
  assert.equal(classifyLeak("<html><body>ok</body></html>"), null, "clean HTML is not a leak");
  assert.equal(classifyLeak(JSON.stringify({ products: [] })), null, "a normal payload is not a leak");

  assert.equal(
    classifyLeak("postgresql://user:hunter2@db.internal:5432/app"),
    "connection string",
    "a connection string with a password is a leak",
  );
  assert.equal(
    classifyLeak("Error: connect ECONNREFUSED\n    at Object.connect (node:net:1234:56)"),
    "stack trace",
    "a stack trace is a leak",
  );
  assert.equal(
    classifyLeak("Missing env DATABASE_URL"),
    "DATABASE_URL",
    "naming DATABASE_URL in a response is a leak",
  );
}

// --- the secrets guard, against the real tree ------------------------------
//
// Run as a subprocess because the guard is a CLI that exits non-zero; this
// asserts the exit code, not just that it printed something.
{
  const output = execFileSync(process.execPath, ["scripts/secrets-hygiene-check.mjs"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.ok(output.includes("PASS"), `the guard must pass against the real tree, got: ${output}`);
  assert.ok(
    output.includes("all matched"),
    "the guard must confirm every allowlist entry still matches; a stale entry is a failure, not a silent pass",
  );
}

// --- the two holes independent review found in the guard -------------------
//
// Both were silent: the guard passed while failing to see the case. Asserting
// the patterns directly is the only way a regression shows up as a failure
// rather than as continued false assurance.
{
  const source = readFileSync("scripts/secrets-hygiene-check.mjs", "utf8");

  const assignmentLine = /^const ASSIGNMENT = \/(.+)\/[a-z]*;$/m.exec(source);
  assert.ok(assignmentLine, "the ASSIGNMENT pattern must be findable in the guard source");
  const assignment = new RegExp(assignmentLine[1], "g");

  // A deploy token in a JSON config is the single most likely way a real
  // credential gets committed, and the original pattern matched none of it.
  //
  // The fixture's value is a placeholder the guard already recognises, so this
  // file does not become another tracked occurrence of a credential-shaped
  // string. That matters: the first version used a realistic value and tripped
  // the guard, which would have meant a fifth allowlist entry. The assertion
  // is about the *key* being seen, and the pattern matches it either way.
  const jsonMatches = [...'{ "VERCEL_TOKEN": "<example-token>" }'.matchAll(assignment)].map((m) => m[2]);
  assert.ok(
    jsonMatches.includes("VERCEL_TOKEN"),
    `a quoted JSON key must be recognised as an assignment, got ${JSON.stringify(jsonMatches)}`,
  );

  // Containment must run one way only. The reverse direction exempted any
  // value that was merely a substring of an approved placeholder.
  assert.ok(
    !source.includes("entry.literal.includes(found)"),
    "allowlist containment must not run in reverse; that exempts any substring of an approved placeholder",
  );
}

// --- the smoke, against a URL that cannot answer ---------------------------
//
// A dead URL fails before any HTTP response exists, so the failure names the
// cause rather than a status. Requiring a status here would be unsatisfiable.
{
  let failed = false;
  let stderr = "";
  try {
    execFileSync(process.execPath, ["scripts/remote-smoke-check.mjs"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, SMOKE_BASE_URL: "http://127.0.0.1:1", SMOKE_EXPECTED_REVISION: "" },
      timeout: 120_000,
    });
  } catch (error) {
    failed = true;
    stderr = String(error.stderr ?? "");
  }
  assert.ok(failed, "the smoke must exit non-zero against an unreachable URL");
  assert.ok(stderr.includes("FAIL"), `the smoke must report FAIL, got: ${stderr}`);
  assert.ok(
    stderr.includes("before any response"),
    `a network failure must name the cause rather than a status, got: ${stderr}`,
  );
}

// --- the smoke, with no base URL -------------------------------------------
{
  let failed = false;
  let stderr = "";
  try {
    const env = { ...process.env };
    delete env.SMOKE_BASE_URL;
    execFileSync(process.execPath, ["scripts/remote-smoke-check.mjs"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
  } catch (error) {
    failed = true;
    stderr = String(error.stderr ?? "");
  }
  assert.ok(failed, "the smoke must exit non-zero without SMOKE_BASE_URL");
  assert.ok(
    stderr.includes("SMOKE_BASE_URL"),
    `a configuration failure must name the missing variable, got: ${stderr}`,
  );
}

console.log("TASK-16 guards: PASS");
