import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * TASK-12 is a read-only consumer of a value PostgreSQL owns (ARCH-01 Option A).
 *
 * These assertions exist because "we agreed not to recompute it" is not a
 * guarantee. They fail if the forecast formula reappears in this task's files,
 * if anything here writes the column, or if the classification rule is
 * duplicated instead of imported from the shared helper.
 */
const root = process.cwd();
const paths = {
  helper: "lib/sales/repurchaseForecast.ts",
  route: "app/api/repurchases/route.ts",
  workspace: "app/repurchases/RepurchaseWorkspace.tsx",
  page: "app/repurchases/page.tsx",
};

const source = Object.fromEntries(
  await Promise.all(
    Object.entries(paths).map(async ([key, path]) => [key, await readFile(resolve(root, path), "utf8")]),
  ),
);

// The forecast formula: soldAt + quantity * consumptionDays. Any arithmetic that
// pairs quantity with consumptionDays is the derivation, and it belongs to the
// TASK-09 triggers alone.
for (const [name, contents] of Object.entries(source)) {
  assert.doesNotMatch(
    contents,
    /consumptionDays/u,
    `${name} references consumptionDays; the forecast derivation belongs to the database`,
  );
  // Assignment form only: `expectedRepurchaseAt: ...` is a legitimate Prisma
  // select/where key or an object-literal read, whereas `expectedRepurchaseAt =`
  // is someone writing to the column or to a row this task fetched.
  assert.doesNotMatch(
    contents,
    /expectedRepurchaseAt\s*=[^=>]/u,
    `${name} assigns expectedRepurchaseAt; this task only reads it`,
  );
}

// Nothing in this task may mutate anything.
for (const [name, contents] of Object.entries(source)) {
  assert.doesNotMatch(
    contents,
    /\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u,
    `${name} contains a Prisma mutation method`,
  );
  assert.doesNotMatch(contents, /\$executeRaw(?:Unsafe)?\s*\(/u, `${name} contains a raw Prisma mutation`);
  assert.doesNotMatch(
    contents,
    /(?:lib\/sales\/registerSale|registerSale|saleTransaction)/u,
    `${name} imports the sale writer`,
  );
}

// The route is GET-only: an exported POST/PUT/PATCH/DELETE would silently create
// a write surface on a read projection.
assert.doesNotMatch(
  source.route,
  /export\s+async\s+function\s+(?:POST|PUT|PATCH|DELETE)\b/u,
  "the repurchase route exports a mutating handler",
);
assert.match(source.route, /export\s+async\s+function\s+GET\b/u, "the repurchase route must export GET");

// One classification rule, imported rather than re-derived.
assert.match(
  source.helper,
  /export\s+function\s+classifyRepurchase/u,
  "the canonical helper must own the classification rule",
);
assert.match(
  source.route,
  /from\s+["']@\/lib\/sales\/repurchaseForecast["']/u,
  "the route must import the canonical classifier",
);
for (const name of ["route", "workspace", "page"]) {
  assert.doesNotMatch(
    source[name],
    /businessDayNumber\s*\(/u,
    `${name} re-derives the business day; that rule lives in lib/format/businessDate.ts`,
  );
}

// The page renders the bucket the server decided; it must not classify again.
assert.doesNotMatch(
  source.workspace,
  /classifyRepurchase|buildRepurchaseView/u,
  "the page must render the server-resolved bucket, never reclassify",
);

// Dates go through the shared business-date contract, not the browser zone.
assert.doesNotMatch(
  source.workspace,
  /toLocaleDateString\s*\(/u,
  "the page must format dates through formatBusinessDate, not the browser locale",
);
assert.match(
  source.workspace,
  /formatBusinessDate/u,
  "the page must use the shared business-date formatter",
);

console.log("TASK-12 source boundary checks: PASS");
