import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const paths = {
  helper: "lib/products/stockAlerts.ts",
  product: "app/products/ProductWorkspace.tsx",
  inventory: "app/inventory/InventoryWorkspace.tsx",
  page: "app/inventory/page.tsx",
};

const source = Object.fromEntries(
  await Promise.all(Object.entries(paths).map(async ([key, path]) => [key, await readFile(resolve(root, path), "utf8")])),
);

assert.match(source.product, /from ["']@\/lib\/products\/stockAlerts["']/u, "products screen does not import the canonical helper");
assert.match(source.inventory, /from ["']@\/lib\/products\/stockAlerts["']/u, "inventory screen does not import the canonical helper");
assert.match(source.helper, /\.currentStock\s*<=\s*.*\.minimumStock/u, "canonical helper does not own the low-stock predicate");

for (const [name, contents] of Object.entries(source)) {
  if (name === "helper") continue;
  assert.doesNotMatch(contents, /\.currentStock\s*<=\s*.*\.minimumStock/u, `${name} contains a duplicate low-stock predicate`);
}

for (const [name, contents] of Object.entries(source)) {
  assert.doesNotMatch(contents, /(?:lib\/sales\/registerSale|registerSale)/u, `${name} imports the sale writer`);
  assert.doesNotMatch(contents, /\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u, `${name} contains a Prisma mutation method`);
  assert.doesNotMatch(contents, /\$executeRaw(?:Unsafe)?\s*\(/u, `${name} contains a raw Prisma mutation`);
}

console.log("TASK-13 source boundary checks: PASS");
