import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

// The migration under test. Everything before it reproduces the two P1
// deadlock cycles; the full chain must make the very same interleavings
// commit cleanly.
const LOCK_ORDER_MIGRATION = "20260819140000_serialize_forecast_lock_order";

const repoRoot = process.cwd();
const migrationsRoot = resolve(repoRoot, "prisma", "migrations");
const schemaPath = resolve(repoRoot, "prisma", "schema.prisma");
const migrationCli = resolve(repoRoot, "node_modules", "prisma", "build", "index.js");
const baseUrl = process.env.DATABASE_URL;
const DAY_MS = 24 * 60 * 60 * 1000;
const TX_OPTIONS = { timeout: 40000, maxWait: 40000 };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function deferred() {
  let resolveFn;
  let rejectFn;
  const promise = new Promise((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

function quoteSchemaName(schemaName) {
  assert(/^[a-z0-9_]+$/.test(schemaName), "Generated schema name contains unsafe characters");
  return `"${schemaName}"`;
}

function urlForSchema(schemaName, singleConnection = false) {
  const url = new URL(baseUrl);
  url.searchParams.set("schema", schemaName);
  // Each contending transaction must stay pinned to one backend so the
  // interleaving below is the one actually exercised.
  if (singleConnection) url.searchParams.set("connection_limit", "1");
  return url.toString();
}

function clientFor(url) {
  return new PrismaClient({ datasources: { db: { url } } });
}

function runMigrations(targetUrl, targetSchemaPath) {
  assert(existsSync(migrationCli), `Prisma CLI not found at ${migrationCli}`);
  const result = spawnSync(
    process.execPath,
    [migrationCli, "migrate", "deploy", "--schema", targetSchemaPath],
    { cwd: repoRoot, env: { ...process.env, DATABASE_URL: targetUrl }, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  assert(result.status === 0, `Migration deploy failed with exit code ${result.status}`);
}

// A migration project holding every migration that precedes the fix, so the
// defect can be observed on a real database instead of argued about.
function createPreLockOrderMigrationProject() {
  const tempRoot = mkdtempSync(join(repoRoot, ".tmp-task09-lockorder-"));
  const tempMigrations = join(tempRoot, "migrations");
  mkdirSync(tempMigrations, { recursive: true });
  cpSync(schemaPath, join(tempRoot, "schema.prisma"));
  cpSync(join(migrationsRoot, "migration_lock.toml"), join(tempMigrations, "migration_lock.toml"));

  const migrationDirectories = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+_.+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const targetIndex = migrationDirectories.indexOf(LOCK_ORDER_MIGRATION);
  assert(targetIndex >= 0, `Target migration ${LOCK_ORDER_MIGRATION} was not found`);

  for (const migrationName of migrationDirectories.slice(0, targetIndex)) {
    cpSync(join(migrationsRoot, migrationName), join(tempMigrations, migrationName), { recursive: true });
  }

  return { root: tempRoot, schema: join(tempRoot, "schema.prisma") };
}

function isDeadlock(error) {
  const text = `${error?.code ?? ""} ${error?.meta?.code ?? ""} ${error?.message ?? error ?? ""}`.toLowerCase();
  return text.includes("40p01") || text.includes("deadlock");
}

function integerLiteral(value, label) {
  assert(Number.isInteger(value), `${label} is not an integer`);
  return String(value);
}

// Waits until a specific statement is actually blocked on a lock. Every step
// of the choreography below advances on this condition rather than on a
// sleep, so the interleaving is reproduced exactly on every run.
async function waitUntilBlocked(monitor, marker, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await monitor.$queryRawUnsafe(
      `SELECT count(*)::int AS blocked
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query LIKE $1`,
      `%${marker}%`,
    );
    if (Number(rows[0].blocked) > 0) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for probe ${marker} to block on a lock`);
}

/**
 * Reproduces one reported P1 cycle with single-statement parent and child
 * operations - the shapes the review actually described (a product PUT that
 * changes consumptionDays, or a correction of Sale.soldAt, racing a legal
 * SaleItem update).
 *
 * The parent's propagation is a single statement, so the window between "the
 * parent row is locked" and "the parent updates the items" cannot be hit by
 * timing alone. A third transaction pins one of the affected items with a
 * plain SELECT ... FOR UPDATE, which holds the parent inside exactly that
 * window - no triggers fire for it, so it never enters the cluster itself
 * and can never be part of a cycle. The child then takes the *other* item and
 * asks for the parent row.
 *
 * Without the fix that closes Product<->SaleItem / Sale<->SaleItem and
 * PostgreSQL aborts one side. With it, the child waits on the shared advisory
 * lock before taking any row lock, so no cycle can form and both commit.
 */
async function runReportedRace({
  schemaName,
  label,
  pinnedItemId,
  parentSql,
  childSql,
  expectDeadlock,
}) {
  const pinnerClient = clientFor(urlForSchema(schemaName, true));
  const parentClient = clientFor(urlForSchema(schemaName, true));
  const childClient = clientFor(urlForSchema(schemaName, true));
  const monitor = clientFor(urlForSchema(schemaName, true));

  const parentMarker = `task09_lockorder_parent_${label}`;
  const childMarker = `task09_lockorder_child_${label}`;

  const pinned = deferred();
  const releasePinner = deferred();

  try {
    const pinnerRun = pinnerClient.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT "id" FROM "SaleItem" WHERE "id" = ${integerLiteral(pinnedItemId, "pinnedItemId")} FOR UPDATE`,
      );
      pinned.resolve();
      await releasePinner.promise;
    }, TX_OPTIONS);

    await pinned.promise;

    // The parent enters first: it locks its own row and then stalls inside
    // its propagation, held by the pinned item.
    const parentRun = parentClient.$transaction(
      async (tx) => tx.$executeRawUnsafe(`/* ${parentMarker} */ ${parentSql}`),
      TX_OPTIONS,
    );
    await waitUntilBlocked(monitor, parentMarker);

    // The child now takes the other item and asks for the parent row.
    const childRun = childClient.$transaction(
      async (tx) => tx.$executeRawUnsafe(`/* ${childMarker} */ ${childSql}`),
      TX_OPTIONS,
    );
    await waitUntilBlocked(monitor, childMarker);

    // Releasing the pin lets the parent try to reach the item the child now
    // holds. That is the moment the cycle closes, if there is one.
    releasePinner.resolve();
    await pinnerRun;

    if (expectDeadlock) {
      const [parentResult, childResult] = await Promise.allSettled([parentRun, childRun]);
      const failures = [parentResult, childResult].filter((entry) => entry.status === "rejected");
      assert(
        failures.some((entry) => isDeadlock(entry.reason)),
        `${label}: expected a deadlock without the lock-order migration, but both transactions completed`,
      );
      return;
    }

    // The parent holds the exclusive advisory lock until it commits, and the
    // child is admitted only afterwards. Awaiting in this order is what makes
    // the post-fix run deterministic rather than timing-dependent.
    await parentRun;
    await childRun;
  } finally {
    releasePinner.resolve();
    pinned.resolve();
    await monitor.$disconnect();
    await childClient.$disconnect();
    await parentClient.$disconnect();
    await pinnerClient.$disconnect();
  }
}

async function seedProductCase(client, label, soldAt, consumptionDays) {
  const customer = await client.customer.create({ data: { name: `TASK-09 lock-order ${label} customer` } });
  const product = await client.product.create({
    data: {
      name: `TASK-09 lock-order ${label} product`,
      unit: "un",
      currentStock: 100,
      minimumStock: 1,
      consumptionDays,
    },
  });
  // Two separate sales of the same product: one gets pinned, the other is
  // the item the child transaction legitimately updates.
  const sales = [];
  for (const suffix of ["pinned", "child"]) {
    const sale = await client.sale.create({
      data: {
        customerId: customer.id,
        soldAt,
        status: "MODEL_TEST",
        items: { create: [{ productId: product.id, quantity: 1 }] },
      },
      include: { items: true },
    });
    sales.push({ suffix, itemId: sale.items[0].id });
  }
  return {
    productId: product.id,
    pinnedItemId: sales[0].itemId,
    childItemId: sales[1].itemId,
  };
}

async function seedSaleCase(client, label, soldAt, consumptionDays) {
  const customer = await client.customer.create({ data: { name: `TASK-09 lock-order ${label} customer` } });
  const products = [];
  for (const suffix of ["pinned", "child"]) {
    const product = await client.product.create({
      data: {
        name: `TASK-09 lock-order ${label} ${suffix} product`,
        unit: "un",
        currentStock: 100,
        minimumStock: 1,
        consumptionDays,
      },
    });
    products.push(product);
  }
  // One sale with two items, so the soldAt propagation has both an item to
  // stall on and an item the child transaction holds.
  const sale = await client.sale.create({
    data: {
      customerId: customer.id,
      soldAt,
      status: "MODEL_TEST",
      items: {
        create: [
          { productId: products[0].id, quantity: 1 },
          { productId: products[1].id, quantity: 1 },
        ],
      },
    },
    include: { items: { orderBy: { id: "asc" } } },
  });
  const pinnedItem = sale.items.find((item) => item.productId === products[0].id);
  const childItem = sale.items.find((item) => item.productId === products[1].id);
  assert(pinnedItem && childItem, "sale-cycle fixture did not create both items");
  return {
    saleId: sale.id,
    pinnedItemId: pinnedItem.id,
    childItemId: childItem.id,
    childProductId: products[1].id,
  };
}

if (!baseUrl) {
  console.error("Sale forecast lock-order tests: FAIL");
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const schemaName = `task09_lockorder_${Date.now()}_${process.pid}`;
const isolatedUrl = urlForSchema(schemaName);
const admin = new PrismaClient();
const preFixProject = createPreLockOrderMigrationProject();
let client;

try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA ${quoteSchemaName(schemaName)}`);

  // ---------------------------------------------------------------
  // 1. Reproduce both reported P1 deadlocks on the chain without the fix.
  // ---------------------------------------------------------------
  runMigrations(isolatedUrl, preFixProject.schema);
  client = clientFor(isolatedUrl);

  const soldAt = new Date("2026-08-19T00:00:00.000Z");

  const brokenProduct = await seedProductCase(client, "broken-product", soldAt, 5);
  await runReportedRace({
    schemaName,
    label: "broken_product",
    pinnedItemId: brokenProduct.pinnedItemId,
    parentSql: `UPDATE "Product" SET "consumptionDays" = 7 WHERE "id" = ${integerLiteral(brokenProduct.productId, "productId")}`,
    childSql: `UPDATE "SaleItem" SET "quantity" = 2 WHERE "id" = ${integerLiteral(brokenProduct.childItemId, "childItemId")}`,
    expectDeadlock: true,
  });

  const brokenSale = await seedSaleCase(client, "broken-sale", soldAt, 5);
  await runReportedRace({
    schemaName,
    label: "broken_sale",
    pinnedItemId: brokenSale.pinnedItemId,
    parentSql: `UPDATE "Sale" SET "soldAt" = TIMESTAMP '2026-09-01 00:00:00' WHERE "id" = ${integerLiteral(brokenSale.saleId, "saleId")}`,
    childSql: `UPDATE "SaleItem" SET "quantity" = 3 WHERE "id" = ${integerLiteral(brokenSale.childItemId, "childItemId")}`,
    expectDeadlock: true,
  });

  await client.$disconnect();
  client = null;

  // ---------------------------------------------------------------
  // 2. Deploy the fix over that same populated database and require the
  //    identical interleavings to commit with correct data.
  // ---------------------------------------------------------------
  runMigrations(isolatedUrl, schemaPath);
  client = clientFor(isolatedUrl);

  const fixedProduct = await seedProductCase(client, "fixed-product", soldAt, 5);
  await runReportedRace({
    schemaName,
    label: "fixed_product",
    pinnedItemId: fixedProduct.pinnedItemId,
    parentSql: `UPDATE "Product" SET "consumptionDays" = 7 WHERE "id" = ${integerLiteral(fixedProduct.productId, "productId")}`,
    childSql: `UPDATE "SaleItem" SET "quantity" = 2 WHERE "id" = ${integerLiteral(fixedProduct.childItemId, "childItemId")}`,
    expectDeadlock: false,
  });

  const pinnedAfter = await client.saleItem.findUniqueOrThrow({ where: { id: fixedProduct.pinnedItemId } });
  assert(
    pinnedAfter.expectedRepurchaseAt?.getTime() === soldAt.getTime() + 7 * DAY_MS,
    `product-cycle propagated forecast is ${pinnedAfter.expectedRepurchaseAt?.toISOString()}; expected soldAt + 7 days`,
  );
  const childAfter = await client.saleItem.findUniqueOrThrow({ where: { id: fixedProduct.childItemId } });
  assert(
    childAfter.expectedRepurchaseAt?.getTime() === soldAt.getTime() + 2 * 7 * DAY_MS,
    `product-cycle updated forecast is ${childAfter.expectedRepurchaseAt?.toISOString()}; expected soldAt + 14 days`,
  );
  const productAfter = await client.product.findUniqueOrThrow({ where: { id: fixedProduct.productId } });
  assert(productAfter.currentStock === 97, `product-cycle stock is ${productAfter.currentStock}; expected 97`);

  const correctedSoldAt = new Date("2026-09-01T00:00:00.000Z");
  const fixedSale = await seedSaleCase(client, "fixed-sale", soldAt, 5);
  await runReportedRace({
    schemaName,
    label: "fixed_sale",
    pinnedItemId: fixedSale.pinnedItemId,
    parentSql: `UPDATE "Sale" SET "soldAt" = TIMESTAMP '2026-09-01 00:00:00' WHERE "id" = ${integerLiteral(fixedSale.saleId, "saleId")}`,
    childSql: `UPDATE "SaleItem" SET "quantity" = 3 WHERE "id" = ${integerLiteral(fixedSale.childItemId, "childItemId")}`,
    expectDeadlock: false,
  });

  const salePinnedAfter = await client.saleItem.findUniqueOrThrow({ where: { id: fixedSale.pinnedItemId } });
  assert(
    salePinnedAfter.expectedRepurchaseAt?.getTime() === correctedSoldAt.getTime() + 5 * DAY_MS,
    `sale-cycle propagated forecast is ${salePinnedAfter.expectedRepurchaseAt?.toISOString()}; expected corrected soldAt + 5 days`,
  );
  const saleChildAfter = await client.saleItem.findUniqueOrThrow({ where: { id: fixedSale.childItemId } });
  assert(
    saleChildAfter.expectedRepurchaseAt?.getTime() === correctedSoldAt.getTime() + 3 * 5 * DAY_MS,
    `sale-cycle updated forecast is ${saleChildAfter.expectedRepurchaseAt?.toISOString()}; expected corrected soldAt + 15 days`,
  );
  const saleProductAfter = await client.product.findUniqueOrThrow({ where: { id: fixedSale.childProductId } });
  assert(saleProductAfter.currentStock === 97, `sale-cycle stock is ${saleProductAfter.currentStock}; expected 97`);

  console.log("Sale forecast lock-order tests: PASS");
} catch (error) {
  console.error("Sale forecast lock-order tests: FAIL");
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
} finally {
  if (client) await client.$disconnect();
  rmSync(preFixProject.root, { recursive: true, force: true });
  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quoteSchemaName(schemaName)} CASCADE`);
  } catch (error) {
    console.error(`Could not drop isolated schema ${schemaName}:`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
  await admin.$disconnect();
}
