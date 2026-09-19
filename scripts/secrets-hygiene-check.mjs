import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

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
 */

const failures = [];

function fail(file, reason) {
  failures.push(`${file}: ${reason}`);
}

// Each entry: the exact literal tolerated, in which file, and why it is safe.
const ALLOWLIST = [
  {
    file: ".env.example",
    literal: "recompra_local_dev_only",
    reason: "local development placeholder; the password names itself as local-dev-only and reaches no shared service",
    matched: false,
  },
  {
    file: ".github/workflows/validate.yml",
    literal: "recompra_ci_only",
    reason: "password for the ephemeral Postgres service container CI creates and destroys per run",
    matched: false,
  },
  {
    file: "docs/operations/LOOP-REGISTER.jsonl",
    literal: "hunter2",
    reason: "the register entry describing the fixture reproduced its password; LOOP-REGISTER is append-only, so a published line cannot be rewritten to remove it. Future entries should describe a credential fixture without reproducing it",
    matched: false,
  },
  {
    file: "scripts/task-16-guards-check.mjs",
    // Deliberately the password fragment alone, not the whole URL: a full
    // connection string here would itself match the pattern this entry
    // exists to allow, and the allowlist would need an entry for its own
    // entry. Naming the smallest identifying fragment avoids that.
    literal: "hunter2",
    reason: "deliberate fixture proving this guard rejects a credential-bearing URL; removing it would remove the proof that the guard can fail",
    matched: false,
  },
];

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
const CODE_VALUE = /^([/(\[{]|new\s|function|async|\(.*\)\s*=>)/;

// Values that are configuration keywords rather than credentials. Without
// this, `id-token: write` in a workflow permissions block reads as a token
// assignment: the key matches SENSITIVE_KEY on "TOKEN" and "write" is a
// four-character value. Found by running this guard against the real tree
// before wiring it in.
const NON_SECRET_VALUE = /^(write|read|read-all|write-all|none|true|false|null|always|never|on|off|auto|required|optional)$/i;

const CONNECTION_URL_WITH_PASSWORD = /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"']+:[^\s:/@"']+@/gi;
const PEM_PRIVATE_KEY = /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/;
// The optional quote before the separator matters: a JSON config writes
// `"VERCEL_TOKEN": "..."`, and without it the pattern consumed the opening
// quote as its delimiter and then found a closing quote where it expected the
// colon — so the single most likely place for a deploy token to be committed
// produced no match at all. Found by independent review on PR 47.
const ASSIGNMENT = /(^|[\s"'{,])["']?([A-Za-z_][A-Za-z0-9_.-]*)["']?\s*[:=]\s*["']?([^"'\s,}]{4,})["']?/g;

function trackedFiles() {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

// The allowlist names the smallest identifying fragment of a secret, and the
// found string contains it: the URL pattern stops at the `@` while the entry
// names the password itself, so `found.includes(literal)` matches.
//
// Containment runs one way only. The reverse direction looked symmetrical and
// was not: it exempted any value that happened to be a substring of an
// approved placeholder, so an unrelated `API_TOKEN=local_dev` passed purely
// because `recompra_local_dev_only` contains `local_dev`. Found by independent
// review on PR 47.
function isAllowed(file, found) {
  for (const entry of ALLOWLIST) {
    if (entry.file !== file) continue;
    if (found.includes(entry.literal)) {
      entry.matched = true;
      return true;
    }
  }
  return false;
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

const files = trackedFiles();

// --- rule 1: no tracked .env files except the example ----------------------
for (const file of files) {
  const base = file.split("/").pop() ?? file;
  if (/^\.env(\..+)?$/.test(base) && base !== ".env.example") {
    fail(file, "a tracked .env file; only .env.example may be committed");
  }
}

for (const file of files) {
  const body = readTextOrNull(file);
  if (body === null) continue;

  // --- rule 2: connection URLs carrying a password -------------------------
  for (const match of body.match(CONNECTION_URL_WITH_PASSWORD) ?? []) {
    if (!isAllowed(file, match)) {
      fail(file, `connection URL with an embedded password (${match.slice(0, 40)}...) is not allowlisted`);
    }
  }

  // --- rule 3: credentials that are not URLs -------------------------------
  if (PEM_PRIVATE_KEY.test(body)) {
    fail(file, "contains a PEM private key block");
  }

  for (const [, , key, value] of body.matchAll(ASSIGNMENT)) {
    if (!SENSITIVE_KEY.test(key)) continue;
    if (PLACEHOLDER_VALUE.test(value) || NON_SECRET_VALUE.test(value) || CODE_VALUE.test(value)) continue;
    // `${{ secrets.X }}` and `process.env.X` are references, not literals.
    if (/\$\{\{|process\.env\.|\$\{?[A-Z_]+\}?/.test(value)) continue;
    if (isAllowed(file, value)) continue;
    fail(file, `${key} is assigned a literal value; sensitive keys must reference a secret store or use a placeholder`);
  }
}

// --- rule 6: workflows must reference secrets, never inline them -----------
for (const file of files.filter((f) => f.startsWith(".github/workflows/"))) {
  const body = readTextOrNull(file);
  if (body === null) continue;
  for (const [, , key, value] of body.matchAll(ASSIGNMENT)) {
    if (!SENSITIVE_KEY.test(key)) continue;
    if (value.includes("${{") || PLACEHOLDER_VALUE.test(value) || NON_SECRET_VALUE.test(value) || CODE_VALUE.test(value) || isAllowed(file, value)) continue;
    fail(file, `${key} is inlined in a workflow; use \${{ secrets.* }}`);
  }
}

// --- rule 5: a stale allowlist entry is a failure --------------------------
for (const entry of ALLOWLIST) {
  if (!entry.matched) {
    fail(entry.file, `allowlist entry no longer matches anything (${entry.literal.slice(0, 40)}...); remove it rather than leaving false assurance`);
  }
}

if (failures.length > 0) {
  console.error("Secrets hygiene: FAIL");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`Secrets hygiene: PASS (${files.length} tracked files, ${ALLOWLIST.length} allowlisted literals, all matched)`);
