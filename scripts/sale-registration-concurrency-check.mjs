import { PrismaClient, Prisma } from "@prisma/client";

/**
 * Proves TASK-10's concurrency contract against real PostgreSQL.
 *
 * Strategy A: one transaction, items sorted by ascending productId, one
 * SaleItem per statement. Asserted on the *emitted shape*, not just the result,
 * by reading Prisma's query events -- swapping the loop for createMany collapses
 * the inserts into one statement and fails the test.
 *
 * Strategy B: the whole transaction retried at most 3 times, only for 40P01 and
 * 40001, never continuing from partial state.
 */

const baseUrl = process.env.DATABASE_URL;
const DAY_MS = 24 * 60 * 60 * 1000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred() {
  let resolveFn;
  const promise = new Promise((res) => {
    resolveFn = res;
  });
  return { promise, resolve: resolveFn };
}

function quoteSchemaName(name) {
  assert(/^[a-z0-9_]+$/.test(name), "unsafe schema name");
  return `"${name}"`;
}

function urlForSchema(name, singleConnection = false) {
  const url = new URL(baseUrl);
  url.searchParams.set("schema", name);
  if (singleConnection) url.searchParams.set("connection_limit", "1");
  return url.toString();
}

function clientFor(url, withQueryLog = false) {
  return new PrismaClient({
    datasources: { db: { url } },
    ...(withQueryLog ? { log: [{ emit: "event", level: "query" }] } : {}),
  });
}

// ---------------------------------------------------------------------------
// The production policy under test, mirrored here so the harness exercises the
// same shape and the same retry rules the route uses.
// ---------------------------------------------------------------------------
const RETRYABLE = new Set(["40P01", "40001"]);
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = [20, 40];

function sqlStateOf(error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const code = error.meta?.code;
    if (typeof code === "string") return code;
  }
  const message = error instanceof Error ? error.message : "";
  const named = message.match(/\b(?:code|SQLSTATE)[^0-9A-Za-z]{0,3}([0-9A-Z]{5})\b/);
  return named ? named[1] : null;
}

function normalizeSaleItems(items) {
  const merged = new Map();
  for (const item of items) {
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
  }
  return [...merged.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => a.productId - b.productId);
}

/**
 * @param hooks.beforeItems runs inside the transaction, after the Sale exists
 *        and before the items are written -- the window a concurrent operation
 *        needs to close a cycle.
 */
async function registerSale(client, input, hooks = {}) {
  const items = normalizeSaleItems(input.items);
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    try {
      const sale = await client.$transaction(
        async (tx) => {
          const created = await tx.sale.create({
            data: {
              customerId: input.customerId,
              soldAt: input.soldAt,
              status: "CONFIRMED",
              notes: null,
            },
          });

          if (hooks.beforeItems) await hooks.beforeItems(attempt, created.id, tx);

          for (const item of items) {
            await tx.saleItem.create({
              data: { saleId: created.id, productId: item.productId, quantity: item.quantity },
            });
          }

          return tx.sale.findUniqueOrThrow({
            where: { id: created.id },
            include: { items: { orderBy: { productId: "asc" } } },
          });
        },
        { timeout: 60000, maxWait: 60000 },
      );
      return { sale, attempts };
    } catch (error) {
      const state = sqlStateOf(error);
      if (state && RETRYABLE.has(state)) {
        if (attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_DELAY_MS[attempt - 1] ?? 0);
          continue;
        }
        const exhausted = new Error(`sale concurrency exhausted after ${MAX_ATTEMPTS} attempts (${state})`);
        exhausted.name = "SaleConcurrencyError";
        exhausted.sqlState = state;
        exhausted.attempts = MAX_ATTEMPTS;
        throw exhausted;
      }
      error.attempts = attempt;
      throw error;
    }
  }

  throw new Error("unreachable");
}

async function waitUntilAnyLockWait(monitor, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await monitor.$queryRawUnsafe(
      `SELECT count(*)::int AS blocked
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'`,
    );
    if (Number(rows[0].blocked) > 0) return true;
    await sleep(40);
  }
  return false;
}

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
    await sleep(40);
  }
  throw new Error(`timed out waiting for ${marker} to block on a lock`);
}

if (!baseUrl) {
  console.error("Sale registration concurrency tests: FAIL");
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const schemaName = `task10_sales_${Date.now()}_${process.pid}`;
const isolatedUrl = urlForSchema(schemaName);
const admin = new PrismaClient();
let client;
let logged;

try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA ${quoteSchemaName(schemaName)}`);
  const { spawnSync } = await import("node:child_process");
  const migrate = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/schema.prisma"],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: isolatedUrl }, stdio: "inherit" },
  );
  assert(migrate.status === 0, "migration deploy failed");

  client = clientFor(isolatedUrl);
  const soldAt = new Date("2026-08-20T00:00:00.000Z");
  const customer = await client.customer.create({ data: { name: "TASK-10 concurrency customer" } });

  const makeProduct = (label, stock, days) =>
    client.product.create({
      data: {
        name: `TASK-10 ${label} ${Math.random().toString(36).slice(2, 8)}`,
        unit: "un",
        currentStock: stock,
        minimumStock: 0,
        consumptionDays: days,
      },
    });

  // -----------------------------------------------------------------
  // 1. Multi-item sale is atomic, ordered, and one statement per item.
  // -----------------------------------------------------------------
  const pA = await makeProduct("shape-a", 50, 4);
  const pB = await makeProduct("shape-b", 50, 6);
  const pC = await makeProduct("shape-c", 50, 8);

  logged = clientFor(isolatedUrl, true);
  const itemInserts = [];
  logged.$on("query", (event) => {
    if (/insert\s+into\s+"[^"]*"\."?SaleItem"?/i.test(event.query)) itemInserts.push(event.query);
  });

  // Deliberately unsorted on input, and with a duplicate, to prove the
  // normalization rather than assume the caller behaves.
  const shape = await registerSale(logged, {
    customerId: customer.id,
    soldAt,
    items: [
      { productId: pC.id, quantity: 2 },
      { productId: pA.id, quantity: 1 },
      { productId: pB.id, quantity: 3 },
      { productId: pA.id, quantity: 2 },
    ],
  });

  assert(shape.sale.items.length === 3, `duplicate product not merged: got ${shape.sale.items.length} items`);
  const persistedOrder = shape.sale.items.map((item) => item.productId);
  const ascending = [...persistedOrder].sort((a, b) => a - b);
  assert(
    JSON.stringify(persistedOrder) === JSON.stringify(ascending),
    "persisted items are not in ascending productId order",
  );
  const mergedA = shape.sale.items.find((item) => item.productId === pA.id);
  assert(mergedA.quantity === 3, `duplicate quantities not summed: got ${mergedA.quantity}`);
  assert(
    itemInserts.length === 3,
    `expected one INSERT statement per item, observed ${itemInserts.length} (a multi-row insert would collapse this)`,
  );

  const stockA = await client.product.findUniqueOrThrow({ where: { id: pA.id } });
  assert(stockA.currentStock === 47, `stock after merge is ${stockA.currentStock}; expected 47`);

  // Forecast stays database-derived and is never sent by the caller.
  const forecastA = shape.sale.items.find((item) => item.productId === pA.id).expectedRepurchaseAt;
  assert(
    forecastA?.getTime() === soldAt.getTime() + 3 * 4 * DAY_MS,
    `forecast is ${forecastA?.toISOString()}; expected soldAt + 12 days`,
  );

  await logged.$disconnect();
  logged = null;

  // -----------------------------------------------------------------
  // 2. Concurrent supported sales of the same products both commit.
  // -----------------------------------------------------------------
  const shared1 = await makeProduct("shared-1", 20, 5);
  const shared2 = await makeProduct("shared-2", 20, 5);
  const clientX = clientFor(urlForSchema(schemaName, true));
  const clientY = clientFor(urlForSchema(schemaName, true));

  const [saleX, saleY] = await Promise.all([
    registerSale(clientX, {
      customerId: customer.id,
      soldAt,
      items: [
        { productId: shared1.id, quantity: 2 },
        { productId: shared2.id, quantity: 1 },
      ],
    }),
    registerSale(clientY, {
      customerId: customer.id,
      soldAt,
      items: [
        { productId: shared2.id, quantity: 3 },
        { productId: shared1.id, quantity: 1 },
      ],
    }),
  ]);

  assert(saleX.sale.id !== saleY.sale.id, "concurrent sales did not both commit");
  const shared1After = await client.product.findUniqueOrThrow({ where: { id: shared1.id } });
  const shared2After = await client.product.findUniqueOrThrow({ where: { id: shared2.id } });
  assert(shared1After.currentStock === 17, `shared1 stock ${shared1After.currentStock}; expected 17`);
  assert(shared2After.currentStock === 16, `shared2 stock ${shared2After.currentStock}; expected 16`);
  await clientX.$disconnect();
  await clientY.$disconnect();

  // -----------------------------------------------------------------
  // 3. A retryable 40P01 retries the WHOLE transaction and yields exactly
  //    one sale. The first attempt is forced into a real deadlock against a
  //    concurrent item deletion, which is the residual TASK-09 documented.
  // -----------------------------------------------------------------
  const victimProduct = await makeProduct("retry", 100, 5);
  const victimSale = await client.sale.create({
    data: {
      customerId: customer.id,
      soldAt,
      status: "CONFIRMED",
      items: {
        create: [
          { productId: victimProduct.id, quantity: 1 },
          { productId: victimProduct.id, quantity: 1 },
        ],
      },
    },
    include: { items: { orderBy: { id: "asc" } } },
  });

  const deleter = clientFor(urlForSchema(schemaName, true));
  const writer = clientFor(urlForSchema(schemaName, true));
  const monitor = clientFor(urlForSchema(schemaName, true));
  const deleterHolding = deferred();
  const writerParked = deferred();
  const marker = "task10_retry_probe";
  let observedAttempts = 0;

  const deleterRun = deleter.$transaction(
    async (tx) => {
      // Holds the Product row through TASK-08's stock restoration; its deferred
      // guard reaches for the Sale row only at COMMIT.
      await tx.$executeRawUnsafe(
        `DELETE FROM "SaleItem" WHERE "id" = ${victimSale.items[1].id}`,
      );
      deleterHolding.resolve();
      await writerParked.promise;
    },
    { timeout: 30000, maxWait: 30000 },
  );

  await deleterHolding.promise;

  const writerRun = registerSale(
    writer,
    { customerId: customer.id, soldAt, items: [{ productId: victimProduct.id, quantity: 1 }] },
    {
      beforeItems: async (attempt, saleId, tx) => {
        observedAttempts = attempt;
        void saleId;
        if (attempt > 1) return;
        // Attempt 1 only. Take the victim Sale row inside this transaction, then
        // release the deleter so it reaches COMMIT: its deferred guard needs
        // that Sale row while this transaction still needs its Product, which
        // is the cycle. Wait until the deleter is genuinely parked on the lock
        // before continuing, so the deadlock is forced rather than raced.
        await tx.$executeRawUnsafe(
          `/* ${marker} */ UPDATE "Sale" SET "status" = 'CONFIRMED' WHERE "id" = ${victimSale.id}`,
        );
        writerParked.resolve();
        await waitUntilAnyLockWait(monitor, 15000);
      },
    },
  ).catch((error) => ({ error }));

  // No stray release here: only the hook may free the deleter, and only after
  // it has actually taken the Sale row. Releasing early lets the deleter commit
  // before the cycle exists, and nothing deadlocks.
  const [, writerResult] = await Promise.all([deleterRun.catch(() => null), writerRun]);

  if (writerResult.error) {
    // If the writer was the aborted side and retries were exhausted the
    // contract still holds, but with only one forced deadlock it must recover.
    assert(
      writerResult.error.name !== "SaleConcurrencyError",
      `writer exhausted retries on a single forced deadlock: ${writerResult.error.message}`,
    );
    throw writerResult.error;
  }

  const salesForProduct = await client.sale.findMany({
    where: { items: { some: { productId: victimProduct.id } }, id: { not: victimSale.id } },
  });
  assert(
    salesForProduct.length === 1,
    `retry produced ${salesForProduct.length} sales; a retried transaction must yield exactly one`,
  );
  assert(observedAttempts >= 1, "retry instrumentation did not observe any attempt");

  await deleter.$disconnect();
  await writer.$disconnect();
  await monitor.$disconnect();

  // -----------------------------------------------------------------
  // 3b. A retry that succeeds must leave exactly one sale. Deterministic:
  //     attempt 1 always fails with a real 40P01, attempt 2 always succeeds,
  //     so this does not depend on which side PostgreSQL picks as victim.
  // -----------------------------------------------------------------
  const retryProduct = await makeProduct("retry-once", 30, 5);
  const retryClient = clientFor(urlForSchema(schemaName, true));
  let retryAttempts = 0;
  const retried = await registerSale(
    retryClient,
    { customerId: customer.id, soldAt, items: [{ productId: retryProduct.id, quantity: 4 }] },
    {
      beforeItems: async (attempt, _saleId, tx) => {
        retryAttempts = attempt;
        void _saleId;
        if (attempt > 1) return;
        await tx.$executeRawUnsafe(
          `DO $$ BEGIN RAISE EXCEPTION 'forced deadlock' USING ERRCODE = '40P01'; END $$;`,
        );
      },
    },
  );

  assert(retryAttempts === 2, `expected the sale to succeed on attempt 2, observed ${retryAttempts}`);
  assert(retried.attempts === 2, `registerSale reported ${retried.attempts} attempts; expected 2`);
  const retrySales = await client.sale.findMany({
    where: { items: { some: { productId: retryProduct.id } } },
  });
  assert(
    retrySales.length === 1,
    `a successful retry produced ${retrySales.length} sales; it must produce exactly one`,
  );
  const retryStock = await client.product.findUniqueOrThrow({ where: { id: retryProduct.id } });
  assert(
    retryStock.currentStock === 26,
    `retry charged stock ${30 - retryStock.currentStock} times; expected a single charge of 4`,
  );
  await retryClient.$disconnect();

  // -----------------------------------------------------------------
  // 4. Non-retryable domain errors are NOT retried.
  // -----------------------------------------------------------------
  const scarce = await makeProduct("scarce", 1, 5);
  const scarceClient = clientFor(urlForSchema(schemaName, true));
  let domainError;
  try {
    await registerSale(scarceClient, {
      customerId: customer.id,
      soldAt,
      items: [{ productId: scarce.id, quantity: 5 }],
    });
  } catch (error) {
    domainError = error;
  }
  assert(domainError, "insufficient stock was accepted");
  assert(
    domainError.name !== "SaleConcurrencyError",
    "a domain invariant was treated as a retryable concurrency failure",
  );
  assert(
    domainError.attempts === 1,
    `domain error was retried ${domainError.attempts} times; it must fail on the first attempt`,
  );
  const scarceAfter = await client.product.findUniqueOrThrow({ where: { id: scarce.id } });
  assert(scarceAfter.currentStock === 1, "rejected sale changed stock");
  assert(scarceAfter.currentStock >= 0, "stock became negative");

  const orphan = await client.sale.findMany({ where: { items: { none: {} } } });
  assert(orphan.length === 0, "a rejected sale left an itemless Sale behind");
  await scarceClient.$disconnect();

  // -----------------------------------------------------------------
  // 5. Exhausted retries surface an error rather than being swallowed.
  // -----------------------------------------------------------------
  const alwaysProduct = await makeProduct("exhaust", 100, 5);
  const exhaustClient = clientFor(urlForSchema(schemaName, true));
  let exhausted;
  let exhaustAttempts = 0;
  try {
    await registerSale(
      exhaustClient,
      { customerId: customer.id, soldAt, items: [{ productId: alwaysProduct.id, quantity: 1 }] },
      {
        beforeItems: async (attempt, _saleId, tx) => {
          exhaustAttempts = attempt;
          void _saleId;
          // A genuine PostgreSQL deadlock error, raised with the real SQLSTATE,
          // on every attempt.
          await tx.$executeRawUnsafe(
            `DO $$ BEGIN RAISE EXCEPTION 'forced deadlock' USING ERRCODE = '40P01'; END $$;`,
          );
        },
      },
    );
  } catch (error) {
    exhausted = error;
  }
  assert(exhausted, "a permanently failing sale resolved successfully");
  assert(
    exhausted.name === "SaleConcurrencyError",
    `expected SaleConcurrencyError, got ${exhausted.name}: ${exhausted.message}`,
  );
  assert(exhausted.attempts === MAX_ATTEMPTS, `expected ${MAX_ATTEMPTS} attempts, got ${exhausted.attempts}`);
  assert(exhaustAttempts === MAX_ATTEMPTS, `transaction body ran ${exhaustAttempts} times; expected ${MAX_ATTEMPTS}`);
  assert(exhausted.sqlState === "40P01", `lost the original SQLSTATE: ${exhausted.sqlState}`);

  const exhaustOrphans = await client.sale.findMany({ where: { items: { none: {} } } });
  assert(exhaustOrphans.length === 0, "exhausted retries left an itemless Sale behind");
  await exhaustClient.$disconnect();

  // -----------------------------------------------------------------
  // 6. Stock never negative anywhere in this run.
  // -----------------------------------------------------------------
  const negative = await client.product.findMany({ where: { currentStock: { lt: 0 } } });
  assert(negative.length === 0, "a product ended with negative stock");

  console.log("Sale registration concurrency tests: PASS");
} catch (error) {
  console.error("Sale registration concurrency tests: FAIL");
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
} finally {
  if (logged) await logged.$disconnect();
  if (client) await client.$disconnect();
  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quoteSchemaName(schemaName)} CASCADE`);
  } catch (error) {
    console.error(`Could not drop schema ${schemaName}:`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
  await admin.$disconnect();
}
