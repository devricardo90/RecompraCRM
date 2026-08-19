import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";

// This harness imports the production TypeScript module directly, so it relies
// on Node's native type stripping. package.json therefore requires Node >= 24,
// the only line CI validates. Fail with an explanation rather than a cryptic
// parse error if someone runs it on an older runtime.
const [nodeMajor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 22) {
  console.error("Sale registration concurrency tests: FAIL");
  console.error(
    `Node ${process.versions.node} cannot import TypeScript directly. This harness drives the production module in lib/sales/saleTransaction.ts and needs Node >= 24 (see package.json engines).`,
  );
  process.exit(1);
}

const {
  MAX_SALE_ATTEMPTS,
  classifySaleError,
  normalizeSaleItems,
  runSaleRegistration,
} = await import("../lib/sales/saleTransaction.ts");
const { parseSaleInput } = await import("../app/api/sales/validation.ts");

/**
 * Proves TASK-10's concurrency contract against real PostgreSQL.
 *
 * Every case drives the *production* implementation
 * (`lib/sales/saleTransaction.ts`) with an isolated client. An earlier version
 * of this harness reimplemented the policy locally, which meant changing the
 * production loop to createMany, dropping normalization, or breaking the retry
 * classification would have left it green.
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

async function waitUntilAnyLockWait(monitor, timeoutMs = 15000) {
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
  // 0. Error classification. This is what makes the retry policy real:
  //    Prisma collapses a genuine 40P01/40001 raised by a typed write into
  //    P2034 and drops the SQLSTATE, so classifying on SQLSTATE alone would
  //    silently disable retry for exactly the writes it protects.
  // -----------------------------------------------------------------
  const knownRequestError = (code, metaCode) => {
    const error = new Error(`simulated ${code}`);
    error.name = "PrismaClientKnownRequestError";
    error.code = code;
    if (metaCode) error.meta = { code: metaCode };
    return error;
  };

  assert(
    classifySaleError(knownRequestError("P2034")) === "retryable",
    "Prisma's normalized write-conflict code P2034 must be retryable",
  );
  assert(
    classifySaleError(knownRequestError("P2003")) === "invariant",
    "Prisma's foreign-key code P2003 must be a domain invariant, not a generic failure",
  );
  assert(
    classifySaleError(new Error("Database error code: `40P01`")) === "retryable",
    "a raw 40P01 must be retryable",
  );
  assert(
    classifySaleError(new Error("Database error code: `40001`")) === "retryable",
    "a raw 40001 must be retryable",
  );
  assert(
    classifySaleError(new Error("Database error code: `23514`")) === "invariant",
    "a CHECK violation must be a domain invariant",
  );
  assert(
    classifySaleError(new Error("Database error code: `22003`")) === "invariant",
    "an unrepresentable forecast (22003) must be a domain invariant, not a generic failure",
  );
  assert(
    classifySaleError(new Error("something else entirely")) === "fatal",
    "an unrecognized error must be fatal, never retried",
  );

  // Aggregate overflow: each line is individually legal, the sum is not.
  let overflowError;
  try {
    normalizeSaleItems([
      { productId: 1, quantity: 2_000_000_000 },
      { productId: 1, quantity: 2_000_000_000 },
    ]);
  } catch (error) {
    overflowError = error;
  }
  assert(overflowError, "a duplicate total above the INTEGER range was accepted");
  assert(
    overflowError.name === "SaleValidationError",
    `expected SaleValidationError, got ${overflowError.name}`,
  );

  // -----------------------------------------------------------------
  // 1. Multi-item sale: atomic, normalized, and one statement per item in
  //    ascending productId order -- asserted on the emitted writes.
  // -----------------------------------------------------------------
  const pA = await makeProduct("shape-a", 5000, 4);
  const pB = await makeProduct("shape-b", 5000, 6);
  const pC = await makeProduct("shape-c", 5000, 8);

  logged = clientFor(isolatedUrl, true);
  const itemInserts = [];
  logged.$on("query", (event) => {
    if (/insert\s+into\s+"[^"]*"\."?SaleItem"?/i.test(event.query)) {
      itemInserts.push(event.params ?? "");
    }
  });

  // Quantities are far from any autoincrement id, so matching a productId in
  // the statement parameters is unambiguous.
  const quantityFor = new Map([
    [pA.id, 101],
    [pB.id, 202],
    [pC.id, 303],
  ]);

  // Deliberately unsorted, with a duplicate, to prove the normalization rather
  // than assume the caller behaves.
  const shape = await runSaleRegistration(logged, {
    customerId: customer.id,
    soldAt,
    status: "CONFIRMED",
    items: [
      { productId: pC.id, quantity: 303 },
      { productId: pA.id, quantity: 100 },
      { productId: pB.id, quantity: 202 },
      { productId: pA.id, quantity: 1 },
    ],
  });

  assert(shape.items.length === 3, `duplicate product not merged: got ${shape.items.length} items`);
  const mergedA = shape.items.find((item) => item.productId === pA.id);
  assert(mergedA.quantity === 101, `duplicate quantities not summed: got ${mergedA.quantity}`);
  assert(
    itemInserts.length === 3,
    `expected one INSERT statement per item, observed ${itemInserts.length} (a multi-row insert collapses this)`,
  );

  // The order actually written, not a sorted read-back: a read-back ordered by
  // productId would look ascending even if the writes were not.
  const observedOrder = itemInserts.map((params) => {
    const numbers = new Set((String(params).match(/\d+/g) ?? []).map(Number));
    const match = [...quantityFor.entries()].find(
      ([productId, quantity]) => numbers.has(productId) && numbers.has(quantity),
    );
    assert(match, `could not identify the product written by statement params ${params}`);
    return match[0];
  });
  const expectedOrder = [...quantityFor.keys()].sort((a, b) => a - b);
  assert(
    JSON.stringify(observedOrder) === JSON.stringify(expectedOrder),
    `items were written in order ${observedOrder} rather than ascending productId ${expectedOrder}`,
  );

  const stockA = await client.product.findUniqueOrThrow({ where: { id: pA.id } });
  assert(stockA.currentStock === 5000 - 101, `stock after merge is ${stockA.currentStock}`);

  const forecastA = shape.items.find((item) => item.productId === pA.id).expectedRepurchaseAt;
  assert(
    forecastA?.getTime() === soldAt.getTime() + 101 * 4 * DAY_MS,
    `forecast is ${forecastA?.toISOString()}; expected soldAt + ${101 * 4} days`,
  );

  await logged.$disconnect();
  logged = null;

  // -----------------------------------------------------------------
  // 2. Concurrent supported sales sharing products both commit.
  // -----------------------------------------------------------------
  const shared1 = await makeProduct("shared-1", 20, 5);
  const shared2 = await makeProduct("shared-2", 20, 5);
  const clientX = clientFor(urlForSchema(schemaName, true));
  const clientY = clientFor(urlForSchema(schemaName, true));

  const [saleX, saleY] = await Promise.all([
    runSaleRegistration(clientX, {
      customerId: customer.id,
      soldAt,
      status: "CONFIRMED",
      items: [
        { productId: shared1.id, quantity: 2 },
        { productId: shared2.id, quantity: 1 },
      ],
    }),
    runSaleRegistration(clientY, {
      customerId: customer.id,
      soldAt,
      status: "CONFIRMED",
      items: [
        { productId: shared2.id, quantity: 3 },
        { productId: shared1.id, quantity: 1 },
      ],
    }),
  ]);

  assert(saleX.id !== saleY.id, "concurrent sales did not both commit");
  const shared1After = await client.product.findUniqueOrThrow({ where: { id: shared1.id } });
  const shared2After = await client.product.findUniqueOrThrow({ where: { id: shared2.id } });
  assert(shared1After.currentStock === 17, `shared1 stock ${shared1After.currentStock}; expected 17`);
  assert(shared2After.currentStock === 16, `shared2 stock ${shared2After.currentStock}; expected 16`);
  await clientX.$disconnect();
  await clientY.$disconnect();

  // -----------------------------------------------------------------
  // 3. A real deadlock against a concurrent item deletion -- the residual
  //    TASK-09 documented -- is survived rather than surfaced.
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

  const deleterRun = deleter.$transaction(
    async (tx) => {
      // Holds the Product row through TASK-08's stock restoration; its deferred
      // guard reaches for the Sale row only at COMMIT.
      await tx.$executeRawUnsafe(`DELETE FROM "SaleItem" WHERE "id" = ${victimSale.items[1].id}`);
      deleterHolding.resolve();
      await writerParked.promise;
    },
    { timeout: 60000, maxWait: 60000 },
  );

  await deleterHolding.promise;

  const writerRun = runSaleRegistration(
    writer,
    {
      customerId: customer.id,
      soldAt,
      status: "CONFIRMED",
      items: [{ productId: victimProduct.id, quantity: 1 }],
    },
    {
      transactionTimeoutMs: 60000,
      hooks: {
        beforeItems: async (attempt, _saleId, tx) => {
          if (attempt > 1) return;
          // Attempt 1 only: take the victim Sale row, then release the deleter
          // so its deferred guard reaches for that same row while this
          // transaction still needs its Product. Wait until it is genuinely
          // parked so the deadlock is forced rather than raced.
          await tx.$executeRawUnsafe(
            `UPDATE "Sale" SET "status" = 'CONFIRMED' WHERE "id" = ${victimSale.id}`,
          );
          writerParked.resolve();
          await waitUntilAnyLockWait(monitor);
        },
      },
    },
  ).catch((error) => ({ error }));

  const [, writerResult] = await Promise.all([deleterRun.catch(() => null), writerRun]);
  if (writerResult?.error) {
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
    `forced deadlock produced ${salesForProduct.length} sales; expected exactly one`,
  );

  await deleter.$disconnect();
  await writer.$disconnect();
  await monitor.$disconnect();

  // -----------------------------------------------------------------
  // 3b. A retry that succeeds leaves exactly one sale. Deterministic:
  //     attempt 1 always fails with a real 40P01, attempt 2 succeeds.
  // -----------------------------------------------------------------
  const retryProduct = await makeProduct("retry-once", 30, 5);
  const retryClient = clientFor(urlForSchema(schemaName, true));
  let retryAttempts = 0;
  await runSaleRegistration(
    retryClient,
    {
      customerId: customer.id,
      soldAt,
      status: "CONFIRMED",
      items: [{ productId: retryProduct.id, quantity: 4 }],
    },
    {
      hooks: {
        beforeItems: async (attempt, _saleId, tx) => {
          retryAttempts = attempt;
          if (attempt > 1) return;
          await tx.$executeRawUnsafe(
            `DO $$ BEGIN RAISE EXCEPTION 'forced deadlock' USING ERRCODE = '40P01'; END $$;`,
          );
        },
      },
    },
  );

  assert(retryAttempts === 2, `expected success on attempt 2, observed ${retryAttempts}`);
  const retrySales = await client.sale.findMany({
    where: { items: { some: { productId: retryProduct.id } } },
  });
  assert(
    retrySales.length === 1,
    `a successful retry produced ${retrySales.length} sales; it must produce exactly one`,
  );
  const retryStock = await client.product.findUniqueOrThrow({ where: { id: retryProduct.id } });
  assert(retryStock.currentStock === 26, `retry charged stock more than once: ${retryStock.currentStock}`);
  await retryClient.$disconnect();

  // -----------------------------------------------------------------
  // 4. Non-retryable domain errors are NOT retried.
  // -----------------------------------------------------------------
  const scarce = await makeProduct("scarce", 1, 5);
  const scarceClient = clientFor(urlForSchema(schemaName, true));
  let attemptsSeen = 0;
  let domainError;
  try {
    await runSaleRegistration(
      scarceClient,
      {
        customerId: customer.id,
        soldAt,
        status: "CONFIRMED",
        items: [{ productId: scarce.id, quantity: 5 }],
      },
      {
        hooks: {
          beforeItems: async (attempt) => {
            attemptsSeen = attempt;
          },
        },
      },
    );
  } catch (error) {
    domainError = error;
  }
  assert(domainError, "insufficient stock was accepted");
  assert(
    domainError.name === "SaleInvariantError",
    `expected SaleInvariantError, got ${domainError.name}: ${domainError.message}`,
  );
  assert(/Estoque insuficiente/.test(domainError.message), `unhelpful message: ${domainError.message}`);
  assert(attemptsSeen === 1, `domain error was retried: transaction body ran ${attemptsSeen} times`);
  const scarceAfter = await client.product.findUniqueOrThrow({ where: { id: scarce.id } });
  assert(scarceAfter.currentStock === 1, "rejected sale changed stock");
  await scarceClient.$disconnect();

  // A missing product is a domain conflict too, not a generic failure.
  const fkClient = clientFor(urlForSchema(schemaName, true));
  let fkError;
  try {
    await runSaleRegistration(fkClient, {
      customerId: customer.id,
      soldAt,
      status: "CONFIRMED",
      items: [{ productId: 2_147_000_000, quantity: 1 }],
    });
  } catch (error) {
    fkError = error;
  }
  assert(fkError, "a sale referencing a missing product was accepted");
  assert(
    fkError.name === "SaleInvariantError",
    `missing product should be a domain invariant, got ${fkError.name}: ${fkError.message}`,
  );
  await fkClient.$disconnect();

  // A forecast that cannot be represented is a deterministic consequence of the
  // submitted values, so it must be a readable domain error, not a generic 503.
  const farProduct = await makeProduct("far-forecast", 5, 2147483647);
  const farClient = clientFor(urlForSchema(schemaName, true));
  let farError;
  try {
    await runSaleRegistration(farClient, {
      customerId: customer.id,
      soldAt,
      status: "CONFIRMED",
      items: [{ productId: farProduct.id, quantity: 2 }],
    });
  } catch (error) {
    farError = error;
  }
  assert(farError, "an unrepresentable forecast was accepted");
  assert(
    farError.name === "SaleInvariantError",
    `unrepresentable forecast should be a domain invariant, got ${farError.name}: ${farError.message}`,
  );
  assert(
    /previsão de recompra/i.test(farError.message),
    `unhelpful message for an unrepresentable forecast: ${farError.message}`,
  );
  await farClient.$disconnect();

  // -----------------------------------------------------------------
  // 5. Exhausted retries surface an error rather than being swallowed.
  // -----------------------------------------------------------------
  const alwaysProduct = await makeProduct("exhaust", 100, 5);
  const exhaustClient = clientFor(urlForSchema(schemaName, true));
  let exhausted;
  let exhaustAttempts = 0;
  try {
    await runSaleRegistration(
      exhaustClient,
      {
        customerId: customer.id,
        soldAt,
        status: "CONFIRMED",
        items: [{ productId: alwaysProduct.id, quantity: 1 }],
      },
      {
        hooks: {
          beforeItems: async (attempt, _saleId, tx) => {
            exhaustAttempts = attempt;
            await tx.$executeRawUnsafe(
              `DO $$ BEGIN RAISE EXCEPTION 'forced deadlock' USING ERRCODE = '40P01'; END $$;`,
            );
          },
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
  assert(exhausted.attempts === MAX_SALE_ATTEMPTS, `expected ${MAX_SALE_ATTEMPTS} attempts`);
  assert(
    exhaustAttempts === MAX_SALE_ATTEMPTS,
    `transaction body ran ${exhaustAttempts} times; expected ${MAX_SALE_ATTEMPTS}`,
  );
  assert(exhausted.sqlState === "40P01", `lost the original SQLSTATE: ${exhausted.sqlState}`);

  const orphans = await client.sale.findMany({ where: { items: { none: {} } } });
  assert(orphans.length === 0, "a failed sale left an itemless Sale behind");
  await exhaustClient.$disconnect();

  // -----------------------------------------------------------------
  // 7. Request validation: a date that does not exist must be rejected, not
  //    silently normalized. new Date("2026-02-30") yields March 2, so a
  //    getTime() check alone would record the sale under a date nobody sent.
  // -----------------------------------------------------------------
  const validPayload = (soldAtValue) => ({
    customerId: customer.id,
    items: [{ productId: pA.id, quantity: 1 }],
    ...(soldAtValue === undefined ? {} : { soldAt: soldAtValue }),
  });

  const accepted = parseSaleInput(validPayload("2026-02-28"));
  assert(
    accepted.soldAt.getUTCDate() === 28 && accepted.soldAt.getUTCMonth() === 1,
    "a real calendar date was not preserved",
  );

  for (const impossible of ["2026-02-30", "2026-02-31", "2025-02-29", "2026-04-31", "2026-00-10"]) {
    let rejected;
    try {
      parseSaleInput(validPayload(impossible));
    } catch (error) {
      rejected = error;
    }
    assert(rejected, `impossible date ${impossible} was accepted`);
    assert(
      rejected.name === "SaleInputError",
      `expected SaleInputError for ${impossible}, got ${rejected.name}`,
    );
  }

  // A leap day that does exist must still be accepted.
  const leap = parseSaleInput(validPayload("2028-02-29"));
  assert(leap.soldAt.getUTCDate() === 29, "a valid leap day was rejected");

  // The derived forecast field is refused outright rather than ignored.
  let derivedRejected;
  try {
    parseSaleInput({
      customerId: customer.id,
      items: [{ productId: pA.id, quantity: 1, expectedRepurchaseAt: "2030-01-01" }],
    });
  } catch (error) {
    derivedRejected = error;
  }
  assert(derivedRejected, "a caller-supplied expectedRepurchaseAt was accepted");

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
