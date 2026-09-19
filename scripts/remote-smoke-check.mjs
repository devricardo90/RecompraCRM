/**
 * TASK-16: the remote smoke for the staging deployment.
 *
 * Read-only by design. A writing smoke would pollute staging on every run,
 * and `Sale_deletion_blocked` makes per-row cleanup impossible there exactly
 * as it does locally — TASK-15 hit that wall and solved it with a throwaway
 * schema, which a remote target does not expose.
 *
 * The revision check is the part that makes the rest mean anything: the four
 * route checks pass identically against a deployment that failed and left the
 * previous revision serving. Comparing the served revision against the
 * expected one is what distinguishes "the deploy worked" from "something is
 * up".
 *
 * Usage:
 *   SMOKE_BASE_URL=https://... [SMOKE_EXPECTED_REVISION=<sha>] \
 *     node scripts/remote-smoke-check.mjs
 */

import { pathToFileURL } from "node:url";

const TIMEOUT_MS = 20_000;

// Anything here appearing in a response body means the deployment is leaking
// internals. Checked against every body the smoke reads.
const LEAK_PATTERNS = [
  { name: "connection string", pattern: /[a-z][a-z0-9+.-]*:\/\/[^\s:/@"']+:[^\s:/@"']+@/i },
  { name: "DATABASE_URL", pattern: /DATABASE_URL/ },
  { name: "stack trace", pattern: /\n\s+at\s+\S+\s+\(?[^\s)]+:\d+:\d+\)?/ },
];

export function classifyLeak(body) {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? null);
  for (const { name, pattern } of LEAK_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  return null;
}

export function evaluateRevision({ served, expected }) {
  if (!expected) return { ok: true, reason: "no expected revision supplied; revision check skipped" };
  if (served === null || served === undefined) {
    return { ok: false, reason: `expected revision ${expected} but the deployment reported none; it cannot confirm which commit is serving` };
  }
  if (served !== expected) {
    return { ok: false, reason: `serving revision ${served}, expected ${expected}; a failed deploy can leave the previous revision live` };
  }
  return { ok: true, reason: `serving the expected revision ${served}` };
}

const failures = [];

function fail(where, reason) {
  failures.push(`[${where}] ${reason}`);
}

async function read(baseUrl, path) {
  const url = `${baseUrl.replace(/\/+$/, "")}${path}`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
  } catch (error) {
    // No HTTP response exists here, so naming a status would be impossible.
    // The cause is named instead.
    fail(path, `request failed before any response: ${error instanceof Error ? error.message : error}`);
    return null;
  }
  const body = await response.text().catch(() => "");

  // Leak classification runs before the status check, and regardless of it.
  // An error page is the single most likely place for a stack trace or a
  // connection string to surface, and reporting only "expected 200, received
  // 500" would hide the more security-relevant fact. AC11 says *any*
  // response. Found by independent review on PR 47.
  const leak = classifyLeak(body);
  if (leak) fail(path, `response body exposes a ${leak}`);

  if (response.status !== 200) {
    fail(path, `expected 200, received ${response.status}`);
    return null;
  }
  return { body, response };
}

function asJson(path, raw) {
  try {
    return JSON.parse(raw);
  } catch {
    fail(path, "response was not valid JSON");
    return null;
  }
}

async function main() {
  const baseUrl = process.env.SMOKE_BASE_URL;
  if (!baseUrl) {
    // A configuration failure: no route and no status to name.
    console.error("[config] SMOKE_BASE_URL is required (the staging base URL, e.g. https://example.vercel.app)");
    process.exit(1);
  }
  const expectedRevision = process.env.SMOKE_EXPECTED_REVISION ?? null;

  const home = await read(baseUrl, "/");
  if (home && !/<html[\s>]/i.test(home.body)) fail("/", "response was not HTML");

  const products = await read(baseUrl, "/api/products");
  if (products) {
    const payload = asJson("/api/products", products.body);
    if (payload && !Array.isArray(payload.products)) fail("/api/products", "payload has no products array");
  }

  const customers = await read(baseUrl, "/api/customers");
  if (customers) {
    const payload = asJson("/api/customers", customers.body);
    if (payload && !Array.isArray(payload.customers)) fail("/api/customers", "payload has no customers array");
  }

  // The real connectivity proof: this route queries saleItem and applies
  // businessDayEndUtc, so an instance that is up but cannot reach its database
  // returns 500 here and the smoke fails.
  const repurchases = await read(baseUrl, "/api/repurchases");
  if (repurchases) {
    const payload = asJson("/api/repurchases", repurchases.body);
    if (payload) {
      if (typeof payload.generatedAt !== "string") fail("/api/repurchases", "payload has no generatedAt");
      if (!payload.counts || typeof payload.counts !== "object") fail("/api/repurchases", "payload has no counts");
      if (!Array.isArray(payload.items)) fail("/api/repurchases", "payload has no items array");
    }
  }

  const version = await read(baseUrl, "/api/version");
  if (version) {
    const payload = asJson("/api/version", version.body);
    if (payload) {
      const verdict = evaluateRevision({ served: payload.revision, expected: expectedRevision });
      if (!verdict.ok) fail("/api/version", verdict.reason);
    }
  }

  if (failures.length > 0) {
    console.error("Remote smoke: FAIL");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  const revisionNote = expectedRevision ? `revision ${expectedRevision} confirmed` : "revision check skipped (no expected revision supplied)";
  console.log(`Remote smoke: PASS against ${baseUrl} (${revisionNote})`);
}

// Only run when invoked directly, so the exported helpers stay testable.
// Same guard the other scripts in this repository use.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
