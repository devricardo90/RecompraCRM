import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * TASK-16: "sem credenciais expostas", proved mechanically rather than by
 * inspection.
 *
 * The design point is the allowlist. Two tracked files legitimately contain
 * Postgres URLs with passwords — `.env.example` and the CI service in
 * `validate.yml` — and both are placeholders for ephemeral services. A guard
 * that simply forbade credential-shaped strings would fail on both the day it
 * landed, get suppressed, and stop meaning anything. So known-safe literals
 * are allowlisted individually, with a reason, and anything else fails.
 *
 * The allowlist is checked for staleness too: an entry that no longer matches
 * anything is a failure, not a silent pass. An allowlist that only ever grows
 * is worse than no guard, because it reads like assurance.
 *
 * `scan` is a pure function over an injected file list and reader. That shape
 * exists so every rule can be exercised against fixtures that are not tracked
 * files. The earlier version read `git ls-files` inline and could only run
 * against the real tree, which meant five of its seven rules had no failing-
 * case test at all — found by independent review on PR 47, and exactly the
 * "a guard that has only ever passed" problem this guard was written to
 * prevent, turned on the guard itself.
 */

// Each entry: the exact literal tolerated, in which file, and why it is safe.
const ALLOWLIST = [
  {
    file: ".env.example",
    literal: "recompra_local_dev_only",
    reason: "local development placeholder; the password names itself as local-dev-only and reaches no shared service",
  },
  {
    file: ".github/workflows/validate.yml",
    literal: "recompra_ci_only",
    reason: "password for the ephemeral Postgres service container CI creates and destroys per run",
  },
  {
    file: "docs/operations/LOOP-REGISTER.jsonl",
    literal: "hunter2",
    reason: "a register entry describing a fixture reproduced its password; LOOP-REGISTER is append-only, so a published line cannot be rewritten to remove it. Future entries describe a credential fixture without reproducing it",
  },
  {
    file: "scripts/task-16-guards-check.mjs",
    // The password fragment alone, not the whole URL: a full connection
    // string here would itself match the pattern this entry exists to allow.
    literal: "hunter2",
    reason: "classifyLeak's fixture, which must remain a credential-shaped string to prove leak detection works",
  },
];

/**
 * Exactly one path is excluded from the scan: the file holding the guard's own
 * rejection fixtures. Proving the guard rejects violations requires violating
 * examples, and without this the examples trip the guard — which happened six
 * times during TASK-16, each time answered with another allowlist entry, which
 * is the growth the allowlist design exists to prevent.
 *
 * The exclusion is deliberately a single exact path rather than a pattern. A
 * pattern would widen silently, and an exclusion that widens is worse than the
 * allowlist growth it replaced. `task-16-guards-check.mjs` asserts both that
 * this list exists and that it has exactly one entry.
 */
export const EXCLUDED_PATHS = Object.freeze(["scripts/fixtures/secrets-hygiene-fixtures.mjs"]);

export function defaultAllowlist() {
  return ALLOWLIST.map((entry) => ({ ...entry, matched: false }));
}

// Keys whose value is a secret by virtue of the key's name.
const SENSITIVE_KEY = /(^|[_.-])(TOKEN|SECRET|API[_-]?KEY|PRIVATE[_-]?KEY|PASSWORD|PASSWD|CREDENTIALS?)([_.-]|$)/i;

// Values that are obviously not real secrets.
const PLACEHOLDER_VALUE = /^(|<[^>]*>|changeme\w*|\w*_local_dev_only|\w*_ci_only|xxx+|\*+|placeholder|example|dummy|test)$/i;

// A value that is source code rather than data: a regex literal, an
// expression, an arrow function. This guard's own pattern definitions are
// named CONNECTION_URL_WITH_PASSWORD and PEM_PRIVATE_KEY, so the key matches
// on "PASSWORD" and "PRIVATE_KEY" and the value is the pattern itself. Found
// when CI ran the guard against a tree where its own source was tracked;
// locally it had passed only because these files were still untracked.
const CODE_VALUE = /^([/(\[{]|new\s|function|async|\(.*\)\s*=>)/;

// Values that are configuration keywords rather than credentials. Without
// this, `id-token: write` in a workflow permissions block reads as a token
// assignment: the key matches SENSITIVE_KEY on "TOKEN" and "write" is a
// four-character value.
const NON_SECRET_VALUE = /^(write|read|read-all|write-all|none|true|false|null|always|never|on|off|auto|required|optional)$/i;

const CONNECTION_URL_WITH_PASSWORD = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"']+:[^\s:/@"']+@/gi;
const PEM_PRIVATE_KEY = /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/;

// The optional quote before the separator matters: a JSON config writes
// `"VERCEL_TOKEN": "..."`, and without it the pattern consumed the opening
// quote as its delimiter and then found a closing quote where it expected the
// colon — so the single most likely place for a deploy token to be committed
// produced no match at all. Found by independent review on PR 47.
const ASSIGNMENT = /(^|[\s"'{,])["']?([A-Za-z_][A-Za-z0-9_.-]*)["']?\s*[:=]\s*["']?([^"'\s,}]{4,})["']?/g;

/**
 * Containment runs one way only. The reverse direction looked symmetrical and
 * was not: it exempted any value that happened to be a substring of an
 * approved placeholder. Found by independent review on PR 47.
 */
function makeIsAllowed(allowlist) {
  return (file, found) => {
    for (const entry of allowlist) {
      if (entry.file !== file) continue;
      if (found.includes(entry.literal)) {
        entry.matched = true;
        return true;
      }
    }
    return false;
  };
}

export function scan({ files, read, allowlist = defaultAllowlist() }) {
  const failures = [];
  const fail = (file, reason) => failures.push(`${file}: ${reason}`);
  const isAllowed = makeIsAllowed(allowlist);

  const scanned = files.filter((file) => !EXCLUDED_PATHS.includes(file));

  // Rule 1 — no tracked .env files except the example.
  for (const file of scanned) {
    const base = file.split("/").pop() ?? file;
    if (/^\.env(\..+)?$/.test(base) && base !== ".env.example") {
      fail(file, "a tracked .env file; only .env.example may be committed");
    }
  }

  for (const file of scanned) {
    const body = read(file);
    if (body === null || body === undefined) continue;

    // Rule 2 — connection URLs carrying a password.
    for (const match of body.match(CONNECTION_URL_WITH_PASSWORD) ?? []) {
      if (!isAllowed(file, match)) {
        fail(file, `connection URL with an embedded password (${match.slice(0, 40)}...) is not allowlisted`);
      }
    }

    // Rule 3 — credentials that are not URLs.
    if (PEM_PRIVATE_KEY.test(body)) fail(file, "contains a PEM private key block");

    for (const [, , key, value] of body.matchAll(ASSIGNMENT)) {
      if (!SENSITIVE_KEY.test(key)) continue;
      if (PLACEHOLDER_VALUE.test(value) || NON_SECRET_VALUE.test(value) || CODE_VALUE.test(value)) continue;
      // `${{ secrets.X }}` and `process.env.X` are references, not literals.
      if (/\$\{\{|process\.env\.|\$\{?[A-Z_]+\}?/.test(value)) continue;
      if (isAllowed(file, value)) continue;
      fail(file, `${key} is assigned a literal value; sensitive keys must reference a secret store or use a placeholder`);
    }

    // Rule 6 — workflows must reference secrets, never inline them.
    if (file.startsWith(".github/workflows/")) {
      for (const [, , key, value] of body.matchAll(ASSIGNMENT)) {
        if (!SENSITIVE_KEY.test(key)) continue;
        if (value.includes("${{") || PLACEHOLDER_VALUE.test(value) || NON_SECRET_VALUE.test(value) || CODE_VALUE.test(value) || isAllowed(file, value)) continue;
        fail(file, `${key} is inlined in a workflow; use \${{ secrets.* }}`);
      }
    }
  }

  // Rule 5 — a stale allowlist entry is a failure.
  for (const entry of allowlist) {
    if (!entry.matched) {
      fail(entry.file, `allowlist entry no longer matches anything (${entry.literal.slice(0, 40)}...); remove it rather than leaving false assurance`);
    }
  }

  return failures;
}

function trackedFiles() {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function readTextOrNull(file) {
  try {
    const body = readFileSync(file, "utf8");
    // Skip anything that looks binary rather than guessing by extension.
    return body.includes("\u0000") ? null : body;
  } catch {
    return null;
  }
}

function main() {
  const files = trackedFiles();
  const allowlist = defaultAllowlist();
  const failures = scan({ files, read: readTextOrNull, allowlist });

  if (failures.length > 0) {
    console.error("Secrets hygiene: FAIL");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log(`Secrets hygiene: PASS (${files.length} tracked files, ${allowlist.length} allowlisted literals, all matched)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
