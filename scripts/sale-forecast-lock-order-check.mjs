import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

// The migration under test. Everything before it reproduces the two P1
// deadlock cycles; the full chain must make the very same interleavings
// commit cleanly.
const LOCK_ORDER_MIGRATION = "20260819140000_serialize_forecast_lock_order";
const SHARE_LOCK_MIGRATION = "20260819160000_drop_redundant_sale_share_lock";
const SALE_LOCK_ORDER_MIGRATION = "20260819180000_order_sale_locks_for_forecast";
const PRODUCT_FIRST_MIGRATION = "20260819200000_lock_product_before_sale_for_forecast";
const BOTH_PRODUCTS_MIGRATION = "20260819220000_lock_both_products_before_sale";

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

// A migration project holding every migration that precedes a given fix, so
// each defect can be observed on a real database instead of argued about.
function createMigrationProjectBefore(boundaryMigration) {
  const tempRoot = mkdtempSync(join(repoRoot, ".tmp-task09-lockorder-"));
  const tempMigrations = join(tempRoot, "migrations");
  mkdirSync(tempMigrations, { recursive: true });
  cpSync(schemaPath, join(tempRoot, "schema.prisma"));
  cpSync(join(migrationsRoot, "migration_lock.toml"), join(tempMigrations, "migration_lock.toml"));

  const migrationDirectories = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+_.+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const targetIndex = migrationDirectories.indexOf(boundaryMigration);
  assert(targetIndex >= 0, `Target migration ${boundaryMigration} was not found`);

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

/**
 * Reproduces the reported cross-sale P2: two transactions moving an item in
 * opposite directions between two multi-item sales (A -> B and B -> A).
 *
 * Both are the *child* direction, so the shared advisory gate admits both by
 * design. Each one's forecast trigger used to take FOR SHARE on its
 * destination Sale, while the deferred TASK-07 guard updates its source Sale
 * at COMMIT - so each held a share lock blocking the other's update.
 *
 * Both statements must therefore complete before either commits, which is
 * what the barrier below enforces.
 */
async function runCrossSaleMove({ schemaName, moveForward, moveBackward, expectDeadlock }) {
  const forwardClient = clientFor(urlForSchema(schemaName, true));
  const backwardClient = clientFor(urlForSchema(schemaName, true));

  const forwardMoved = deferred();
  const backwardMoved = deferred();

  try {
    // The pre-fix cycle only closes if both statements run before either
    // commits, so that case synchronises on a barrier. After the fix the two
    // moves serialize on the ordered row locks, which makes that barrier
    // unsatisfiable by construction - so it is used only to prove the defect.
    const useBarrier = expectDeadlock;

    const forwardRun = forwardClient.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(moveForward);
      forwardMoved.resolve();
      if (useBarrier) await backwardMoved.promise;
    }, TX_OPTIONS);

    const backwardRun = backwardClient.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(moveBackward);
      backwardMoved.resolve();
      if (useBarrier) await forwardMoved.promise;
    }, TX_OPTIONS);

    const [forwardResult, backwardResult] = await Promise.allSettled([forwardRun, backwardRun]);

    if (expectDeadlock) {
      const failures = [forwardResult, backwardResult].filter((entry) => entry.status === "rejected");
      assert(
        failures.some((entry) => isDeadlock(entry.reason)),
        "expected a deadlock from opposite-direction cross-sale moves before the share-lock fix",
      );
      return;
    }

    for (const [name, entry] of [["forward", forwardResult], ["backward", backwardResult]]) {
      assert(
        entry.status === "fulfilled",
        `${name} cross-sale move failed after the fix: ${entry.reason?.message ?? entry.reason}`,
      );
    }
  } finally {
    forwardMoved.resolve();
    backwardMoved.resolve();
    await backwardClient.$disconnect();
    await forwardClient.$disconnect();
  }
}

// Two sales of two items each, so moving one item out is legal - TASK-07 only
// blocks removing the last item of a sale.
async function seedCrossSaleCase(client, label, soldAtA, soldAtB, consumptionDays) {
  const customer = await client.customer.create({ data: { name: `TASK-09 cross-sale ${label} customer` } });
  const products = [];
  for (const suffix of ["a1", "a2", "b1", "b2"]) {
    products.push(
      await client.product.create({
        data: {
          name: `TASK-09 cross-sale ${label} ${suffix} product`,
          unit: "un",
          currentStock: 100,
          minimumStock: 1,
          consumptionDays,
        },
      }),
    );
  }
  const makeSale = async (soldAt, first, second) => {
    const sale = await client.sale.create({
      data: {
        customerId: customer.id,
        soldAt,
        status: "MODEL_TEST",
        items: {
          create: [
            { productId: first.id, quantity: 1 },
            { productId: second.id, quantity: 1 },
          ],
        },
      },
      include: { items: true },
    });
    return { id: sale.id, movedItemId: sale.items.find((item) => item.productId === first.id).id };
  };
  const saleA = await makeSale(soldAtA, products[0], products[1]);
  const saleB = await makeSale(soldAtB, products[2], products[3]);
  return { saleA, saleB };
}


function isSerializationFailure(error) {
  const text = `${error?.code ?? ""} ${error?.meta?.code ?? ""} ${error?.message ?? error ?? ""}`.toLowerCase();
  return text.includes("40001") || text.includes("could not serialize");
}

/**
 * Reproduces the reported REPEATABLE READ staleness: a writer whose snapshot
 * predates a committed soldAt correction must not persist a forecast built on
 * the old date. The advisory gate cannot help here - the correction is already
 * committed, so there is no overlap in time to exclude, and the parent's
 * propagation cannot repair the row because it was not attached to the sale
 * when the propagation ran.
 *
 * Before the fix the plain read serves the stale snapshot and the wrong
 * forecast commits. After it, the locking read makes PostgreSQL reject the
 * stale writer with a serialization failure.
 */
async function runStaleSnapshotInsert({ schemaName, saleId, productId, staleSoldAt, correctedSoldAt, consumptionDays, expectStale }) {
  const writerClient = clientFor(urlForSchema(schemaName, true));
  const correctorClient = clientFor(urlForSchema(schemaName, true));
  const reader = clientFor(urlForSchema(schemaName, true));

  const snapshotTaken = deferred();
  const correctionCommitted = deferred();

  let createdItemId = null;
  let writerError = null;

  try {
    const writerRun = writerClient
      .$transaction(
        async (tx) => {
          // Fixes this transaction's snapshot before the correction commits.
          await tx.$queryRawUnsafe(`SELECT "soldAt" FROM "Sale" WHERE "id" = ${integerLiteral(saleId, "saleId")}`);
          snapshotTaken.resolve();
          await correctionCommitted.promise;
          // Raw insert so the PostgreSQL SQLSTATE survives: the typed client
          // collapses 40001 and 40P01 into one generic write-conflict error,
          // and this case must assert a serialization failure specifically.
          const [created] = await tx.$queryRawUnsafe(
            `INSERT INTO "SaleItem" ("saleId", "productId", "quantity")
             VALUES (${integerLiteral(saleId, "saleId")}, ${integerLiteral(productId, "productId")}, 1)
             RETURNING "id"`,
          );
          createdItemId = created.id;
        },
        { ...TX_OPTIONS, isolationLevel: "RepeatableRead" },
      )
      .catch((error) => {
        writerError = error;
      });

    await snapshotTaken.promise;

    await correctorClient.$transaction(
      async (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE "Sale" SET "soldAt" = TIMESTAMP '${correctedSoldAt}' WHERE "id" = ${integerLiteral(saleId, "saleId")}`,
        ),
      TX_OPTIONS,
    );
    correctionCommitted.resolve();
    await writerRun;

    if (expectStale) {
      assert(!writerError, `stale writer unexpectedly failed before the fix: ${writerError?.message ?? writerError}`);
      assert(createdItemId !== null, "stale writer did not create an item before the fix");
      const [row] = await reader.$queryRawUnsafe(
        `SELECT "expectedRepurchaseAt" AS f FROM "SaleItem" WHERE "id" = ${integerLiteral(createdItemId, "createdItemId")}`,
      );
      const expectedStale = staleSoldAt.getTime() + consumptionDays * DAY_MS;
      assert(
        row.f instanceof Date && row.f.getTime() === expectedStale,
        `expected the pre-fix run to persist a stale forecast at ${new Date(expectedStale).toISOString()}, got ${row.f?.toISOString?.() ?? row.f}`,
      );
      return;
    }

    assert(
      writerError && isSerializationFailure(writerError),
      `expected a serialization failure for the stale REPEATABLE READ writer, got ${writerError?.message ?? "success"}`,
    );
    if (createdItemId !== null) {
      const rows = await reader.$queryRawUnsafe(
        `SELECT "id" FROM "SaleItem" WHERE "id" = ${integerLiteral(createdItemId, "createdItemId")}`,
      );
      assert(rows.length === 0, "rejected stale writer still left an item behind");
    }
  } finally {
    snapshotTaken.resolve();
    correctionCommitted.resolve();
    await reader.$disconnect();
    await correctorClient.$disconnect();
    await writerClient.$disconnect();
  }
}


// A sale that already has an item, so a soldAt correction has something to
// propagate to, plus a product for the racing writer to insert.
async function seedStaleSnapshotCase(client, label, soldAt, consumptionDays) {
  const customer = await client.customer.create({ data: { name: `TASK-09 stale-snapshot ${label} customer` } });
  const existingProduct = await client.product.create({
    data: {
      name: `TASK-09 stale-snapshot ${label} existing product`,
      unit: "un",
      currentStock: 100,
      minimumStock: 1,
      consumptionDays,
    },
  });
  const insertedProduct = await client.product.create({
    data: {
      name: `TASK-09 stale-snapshot ${label} inserted product`,
      unit: "un",
      currentStock: 100,
      minimumStock: 1,
      consumptionDays,
    },
  });
  const sale = await client.sale.create({
    data: {
      customerId: customer.id,
      soldAt,
      status: "MODEL_TEST",
      items: { create: [{ productId: existingProduct.id, quantity: 1 }] },
    },
  });
  return { saleId: sale.id, productId: insertedProduct.id };
}


/**
 * Reproduces the reported write-vs-delete cycle. An insert or quantity update
 * and the deletion of another item of the same sale and product are both legal
 * and both the child direction, so the shared advisory gate admits them
 * together.
 *
 * The delete path reaches Product first (TASK-08 restores stock in an AFTER
 * DELETE trigger) and Sale last (TASK-07's guard runs at COMMIT), and neither
 * can be reordered. So if the forecast trigger locks Sale before Product, the
 * writer holds the Sale row and waits for the Product row while the delete
 * holds Product and waits, at commit, for that Sale.
 */
async function runWriteVsDelete({ schemaName, label, deleteSql, writeSql, expectDeadlock }) {
  const deleteClient = clientFor(urlForSchema(schemaName, true));
  const writeClient = clientFor(urlForSchema(schemaName, true));
  const monitor = clientFor(urlForSchema(schemaName, true));

  const writeMarker = `task09_write_vs_delete_${label}`;
  const deleted = deferred();
  const writerParked = deferred();

  try {
    const deleteRun = deleteClient.$transaction(async (tx) => {
      // Holds the Product row through TASK-08's stock restoration; the Sale
      // row is only touched by the deferred guard at COMMIT.
      await tx.$executeRawUnsafe(deleteSql);
      deleted.resolve();
      await writerParked.promise;
    }, TX_OPTIONS);

    await deleted.promise;

    const writeRun = writeClient.$transaction(
      async (tx) => tx.$executeRawUnsafe(`/* ${writeMarker} */ ${writeSql}`),
      TX_OPTIONS,
    );
    await waitUntilBlocked(monitor, writeMarker);

    // Letting the delete commit is what makes its deferred guard reach for the
    // Sale row - the moment the cycle closes, if there is one.
    writerParked.resolve();

    if (expectDeadlock) {
      const [deleteResult, writeResult] = await Promise.allSettled([deleteRun, writeRun]);
      const failures = [deleteResult, writeResult].filter((entry) => entry.status === "rejected");
      assert(
        failures.some((entry) => isDeadlock(entry.reason)),
        `${label}: expected a deadlock between the write and delete paths before the fix`,
      );
      return;
    }

    // With Product locked first the writer never holds the Sale row while
    // waiting, so the delete commits and releases it.
    await deleteRun;
    await writeRun;
  } finally {
    writerParked.resolve();
    deleted.resolve();
    await monitor.$disconnect();
    await writeClient.$disconnect();
    await deleteClient.$disconnect();
  }
}

// One sale holding two items of the same product, so deleting one is legal and
// its stock restoration touches the product the other item is writing.
async function seedWriteVsDeleteCase(client, label, soldAt, consumptionDays) {
  const customer = await client.customer.create({ data: { name: `TASK-09 write-vs-delete ${label} customer` } });
  const product = await client.product.create({
    data: {
      name: `TASK-09 write-vs-delete ${label} product`,
      unit: "un",
      currentStock: 100,
      minimumStock: 1,
      consumptionDays,
    },
  });
  const sale = await client.sale.create({
    data: {
      customerId: customer.id,
      soldAt,
      status: "MODEL_TEST",
      items: {
        create: [
          { productId: product.id, quantity: 1 },
          { productId: product.id, quantity: 1 },
        ],
      },
    },
    include: { items: { orderBy: { id: "asc" } } },
  });
  return {
    productId: product.id,
    writtenItemId: sale.items[0].id,
    deletedItemId: sale.items[1].id,
  };
}


// One sale holding two items of the same product, plus a second product to
// reassign one of them to. Deleting the other item is legal and its stock
// restoration touches the product the reassignment must also charge back.
async function seedReassignVsDeleteCase(client, label, soldAt, oldConsumptionDays, newConsumptionDays) {
  const customer = await client.customer.create({ data: { name: `TASK-09 reassign ${label} customer` } });
  const oldProduct = await client.product.create({
    data: {
      name: `TASK-09 reassign ${label} old product`,
      unit: "un",
      currentStock: 100,
      minimumStock: 1,
      consumptionDays: oldConsumptionDays,
    },
  });
  const newProduct = await client.product.create({
    data: {
      name: `TASK-09 reassign ${label} new product`,
      unit: "un",
      currentStock: 100,
      minimumStock: 1,
      consumptionDays: newConsumptionDays,
    },
  });
  const sale = await client.sale.create({
    data: {
      customerId: customer.id,
      soldAt,
      status: "MODEL_TEST",
      items: {
        create: [
          { productId: oldProduct.id, quantity: 1 },
          { productId: oldProduct.id, quantity: 1 },
        ],
      },
    },
    include: { items: { orderBy: { id: "asc" } } },
  });
  return {
    oldProductId: oldProduct.id,
    newProductId: newProduct.id,
    reassignedItemId: sale.items[0].id,
    deletedItemId: sale.items[1].id,
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
const preLockOrderProject = createMigrationProjectBefore(LOCK_ORDER_MIGRATION);
const preShareLockProject = createMigrationProjectBefore(SHARE_LOCK_MIGRATION);
const preSaleLockOrderProject = createMigrationProjectBefore(SALE_LOCK_ORDER_MIGRATION);
const preProductFirstProject = createMigrationProjectBefore(PRODUCT_FIRST_MIGRATION);
const preBothProductsProject = createMigrationProjectBefore(BOTH_PRODUCTS_MIGRATION);
let client;

try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA ${quoteSchemaName(schemaName)}`);

  // ---------------------------------------------------------------
  // 1. Reproduce both reported P1 deadlocks on the chain without the fix.
  // ---------------------------------------------------------------
  runMigrations(isolatedUrl, preLockOrderProject.schema);
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
  // 2. Advance to the reviewed head (lock-order fix present, share-lock fix
  //    absent) and reproduce the cross-sale P2 that survived that gate.
  // ---------------------------------------------------------------
  runMigrations(isolatedUrl, preShareLockProject.schema);
  client = clientFor(isolatedUrl);

  const soldAtB = new Date("2026-09-01T00:00:00.000Z");
  const brokenCrossSale = await seedCrossSaleCase(client, "broken", soldAt, soldAtB, 5);
  await runCrossSaleMove({
    schemaName,
    moveForward: `UPDATE "SaleItem" SET "saleId" = ${integerLiteral(brokenCrossSale.saleB.id, "saleBId")} WHERE "id" = ${integerLiteral(brokenCrossSale.saleA.movedItemId, "saleAItemId")}`,
    moveBackward: `UPDATE "SaleItem" SET "saleId" = ${integerLiteral(brokenCrossSale.saleA.id, "saleAId")} WHERE "id" = ${integerLiteral(brokenCrossSale.saleB.movedItemId, "saleBItemId")}`,
    expectDeadlock: true,
  });

  await client.$disconnect();
  client = null;

  // ---------------------------------------------------------------
  // 3. Advance to the round-4 head (share lock dropped, key-share lock
  //    absent) and reproduce the REPEATABLE READ stale-snapshot forecast.
  // ---------------------------------------------------------------
  runMigrations(isolatedUrl, preSaleLockOrderProject.schema);
  client = clientFor(isolatedUrl);

  const staleCase = await seedStaleSnapshotCase(client, "broken", soldAt, 5);
  await runStaleSnapshotInsert({
    schemaName,
    saleId: staleCase.saleId,
    productId: staleCase.productId,
    staleSoldAt: soldAt,
    correctedSoldAt: "2026-09-01 00:00:00",
    consumptionDays: 5,
    expectStale: true,
  });

  await client.$disconnect();
  client = null;

  // ---------------------------------------------------------------
  // 4. Advance to the round-5 head (Sale locked before Product) and
  //    reproduce the write-vs-delete cycle that ordering created.
  // ---------------------------------------------------------------
  runMigrations(isolatedUrl, preProductFirstProject.schema);
  client = clientFor(isolatedUrl);

  const brokenWriteDelete = await seedWriteVsDeleteCase(client, "broken", soldAt, 5);
  await runWriteVsDelete({
    schemaName,
    label: "broken",
    deleteSql: `DELETE FROM "SaleItem" WHERE "id" = ${integerLiteral(brokenWriteDelete.deletedItemId, "deletedItemId")}`,
    writeSql: `UPDATE "SaleItem" SET "quantity" = 2 WHERE "id" = ${integerLiteral(brokenWriteDelete.writtenItemId, "writtenItemId")}`,
    expectDeadlock: true,
  });

  await client.$disconnect();
  client = null;

  // ---------------------------------------------------------------
  // 5. Advance to the round-6 head (only the new Product locked) and
  //    reproduce the reassignment-vs-delete cycle through the old Product.
  // ---------------------------------------------------------------
  runMigrations(isolatedUrl, preBothProductsProject.schema);
  client = clientFor(isolatedUrl);

  const brokenReassign = await seedReassignVsDeleteCase(client, "broken", soldAt, 5, 9);
  await runWriteVsDelete({
    schemaName,
    label: "broken_reassign",
    deleteSql: `DELETE FROM "SaleItem" WHERE "id" = ${integerLiteral(brokenReassign.deletedItemId, "deletedItemId")}`,
    writeSql: `UPDATE "SaleItem" SET "productId" = ${integerLiteral(brokenReassign.newProductId, "newProductId")} WHERE "id" = ${integerLiteral(brokenReassign.reassignedItemId, "reassignedItemId")}`,
    expectDeadlock: true,
  });

  await client.$disconnect();
  client = null;

  // ---------------------------------------------------------------
  // 6. Deploy the full chain over that same populated database and require
  //    every one of those interleavings to behave correctly.
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

  const fixedCrossSale = await seedCrossSaleCase(client, "fixed", soldAt, soldAtB, 5);
  await runCrossSaleMove({
    schemaName,
    moveForward: `UPDATE "SaleItem" SET "saleId" = ${integerLiteral(fixedCrossSale.saleB.id, "saleBId")} WHERE "id" = ${integerLiteral(fixedCrossSale.saleA.movedItemId, "saleAItemId")}`,
    moveBackward: `UPDATE "SaleItem" SET "saleId" = ${integerLiteral(fixedCrossSale.saleA.id, "saleAId")} WHERE "id" = ${integerLiteral(fixedCrossSale.saleB.movedItemId, "saleBItemId")}`,
    expectDeadlock: false,
  });

  // Each moved item must now be re-forecast against its destination sale.
  const movedForward = await client.saleItem.findUniqueOrThrow({ where: { id: fixedCrossSale.saleA.movedItemId } });
  assert(
    movedForward.saleId === fixedCrossSale.saleB.id,
    "forward cross-sale move did not land on the destination sale",
  );
  assert(
    movedForward.expectedRepurchaseAt?.getTime() === soldAtB.getTime() + 5 * DAY_MS,
    `forward moved forecast is ${movedForward.expectedRepurchaseAt?.toISOString()}; expected sale B soldAt + 5 days`,
  );
  const movedBackward = await client.saleItem.findUniqueOrThrow({ where: { id: fixedCrossSale.saleB.movedItemId } });
  assert(
    movedBackward.saleId === fixedCrossSale.saleA.id,
    "backward cross-sale move did not land on the destination sale",
  );
  assert(
    movedBackward.expectedRepurchaseAt?.getTime() === soldAt.getTime() + 5 * DAY_MS,
    `backward moved forecast is ${movedBackward.expectedRepurchaseAt?.toISOString()}; expected sale A soldAt + 5 days`,
  );

  const fixedStaleCase = await seedStaleSnapshotCase(client, "fixed", soldAt, 5);
  await runStaleSnapshotInsert({
    schemaName,
    saleId: fixedStaleCase.saleId,
    productId: fixedStaleCase.productId,
    staleSoldAt: soldAt,
    correctedSoldAt: "2026-09-01 00:00:00",
    consumptionDays: 5,
    expectStale: false,
  });

  const fixedWriteDelete = await seedWriteVsDeleteCase(client, "fixed", soldAt, 5);
  await runWriteVsDelete({
    schemaName,
    label: "fixed",
    deleteSql: `DELETE FROM "SaleItem" WHERE "id" = ${integerLiteral(fixedWriteDelete.deletedItemId, "deletedItemId")}`,
    writeSql: `UPDATE "SaleItem" SET "quantity" = 2 WHERE "id" = ${integerLiteral(fixedWriteDelete.writtenItemId, "writtenItemId")}`,
    expectDeadlock: false,
  });

  const writtenAfter = await client.saleItem.findUniqueOrThrow({ where: { id: fixedWriteDelete.writtenItemId } });
  assert(
    writtenAfter.expectedRepurchaseAt?.getTime() === soldAt.getTime() + 2 * 5 * DAY_MS,
    `write-vs-delete forecast is ${writtenAfter.expectedRepurchaseAt?.toISOString()}; expected soldAt + 10 days`,
  );
  const writeDeleteProduct = await client.product.findUniqueOrThrow({ where: { id: fixedWriteDelete.productId } });
  assert(
    writeDeleteProduct.currentStock === 98,
    `write-vs-delete stock is ${writeDeleteProduct.currentStock}; expected 98`,
  );

  const fixedReassign = await seedReassignVsDeleteCase(client, "fixed", soldAt, 5, 9);
  await runWriteVsDelete({
    schemaName,
    label: "fixed_reassign",
    deleteSql: `DELETE FROM "SaleItem" WHERE "id" = ${integerLiteral(fixedReassign.deletedItemId, "deletedItemId")}`,
    writeSql: `UPDATE "SaleItem" SET "productId" = ${integerLiteral(fixedReassign.newProductId, "newProductId")} WHERE "id" = ${integerLiteral(fixedReassign.reassignedItemId, "reassignedItemId")}`,
    expectDeadlock: false,
  });

  const reassignedAfter = await client.saleItem.findUniqueOrThrow({ where: { id: fixedReassign.reassignedItemId } });
  assert(
    reassignedAfter.productId === fixedReassign.newProductId,
    "reassignment did not land on the new product",
  );
  assert(
    reassignedAfter.expectedRepurchaseAt?.getTime() === soldAt.getTime() + 9 * DAY_MS,
    `reassigned forecast is ${reassignedAfter.expectedRepurchaseAt?.toISOString()}; expected soldAt + 9 days`,
  );
  // Old product: 100 - 2 items, +1 from the delete, +1 from the reassignment.
  const oldProductAfter = await client.product.findUniqueOrThrow({ where: { id: fixedReassign.oldProductId } });
  assert(oldProductAfter.currentStock === 100, `old product stock is ${oldProductAfter.currentStock}; expected 100`);
  const newProductAfter = await client.product.findUniqueOrThrow({ where: { id: fixedReassign.newProductId } });
  assert(newProductAfter.currentStock === 99, `new product stock is ${newProductAfter.currentStock}; expected 99`);

  console.log("Sale forecast lock-order tests: PASS");
} catch (error) {
  console.error("Sale forecast lock-order tests: FAIL");
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
} finally {
  if (client) await client.$disconnect();
  rmSync(preLockOrderProject.root, { recursive: true, force: true });
  rmSync(preShareLockProject.root, { recursive: true, force: true });
  rmSync(preSaleLockOrderProject.root, { recursive: true, force: true });
  rmSync(preProductFirstProject.root, { recursive: true, force: true });
  rmSync(preBothProductsProject.root, { recursive: true, force: true });
  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quoteSchemaName(schemaName)} CASCADE`);
  } catch (error) {
    console.error(`Could not drop isolated schema ${schemaName}:`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
  await admin.$disconnect();
}
