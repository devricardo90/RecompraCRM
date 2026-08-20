import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";

// Drives the production read model and the production date module, not copies
// of them -- the rule TASK-10 established after its harness was found testing a
// private reimplementation.
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 22) {
  console.error("Customer history tests: FAIL");
  console.error(`Node ${process.versions.node} cannot import TypeScript directly; needs Node >= 24.`);
  process.exit(1);
}

const {
  CustomerHistoryError,
  MAX_HISTORY_LIMIT,
  parseHistoryCursor,
  parseHistoryLimit,
  readCustomerHistory,
} = await import("../lib/customers/customerHistory.ts");
const { formatBusinessDate, parseBusinessDateInput } = await import("../lib/format/businessDate.ts");
const { parseSaleInput } = await import("../app/api/sales/validation.ts");

const baseUrl = process.env.DATABASE_URL;
const DAY_MS = 24 * 60 * 60 * 1000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function quoteSchemaName(name) {
  assert(/^[a-z0-9_]+$/.test(name), "unsafe schema name");
  return `"${name}"`;
}

function urlForSchema(name) {
  const url = new URL(baseUrl);
  url.searchParams.set("schema", name);
  return url.toString();
}

if (!baseUrl) {
  console.error("Customer history tests: FAIL");
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const schemaName = `task11_history_${Date.now()}_${process.pid}`;
const isolatedUrl = urlForSchema(schemaName);
const admin = new PrismaClient();
let client;

try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA ${quoteSchemaName(schemaName)}`);
  const migrate = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/schema.prisma"],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: isolatedUrl }, stdio: "inherit" },
  );
  assert(migrate.status === 0, "migration deploy failed");
  client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } });

  // ---------------------------------------------------------------
  // 12-14. soldAt interpretation: date-only, offset-less, every offset form.
  // ---------------------------------------------------------------
  const interpretation = [
    ["2026-08-20", "2026-08-20T03:00:00.000Z", "20/08/2026"],
    ["2026-08-20T14:30", "2026-08-20T17:30:00.000Z", "20/08/2026"],
    ["2026-08-20T23:30Z", "2026-08-20T23:30:00.000Z", "20/08/2026"],
    ["2026-08-20T23:30-04:00", "2026-08-21T03:30:00.000Z", "21/08/2026"],
    ["2026-08-20T23:30-0400", "2026-08-21T03:30:00.000Z", "21/08/2026"],
    ["2026-08-20T23:30+04:00", "2026-08-20T19:30:00.000Z", "20/08/2026"],
    ["2026-08-20T23:30+0400", "2026-08-20T19:30:00.000Z", "20/08/2026"],
    // 15-16. DST: gap at the boundary and inside it, and the overlap.
    ["2018-11-04", "2018-11-04T03:00:00.000Z", "04/11/2018"],
    ["2018-11-04T00:30", "2018-11-04T03:30:00.000Z", "04/11/2018"],
    ["2019-02-16T23:30", "2019-02-17T01:30:00.000Z", "16/02/2019"],
  ];
  for (const [input, expectedIso, expectedDay] of interpretation) {
    const parsed = parseBusinessDateInput(input);
    assert(
      parsed.toISOString() === expectedIso,
      `"${input}" stored ${parsed.toISOString()}; expected ${expectedIso}`,
    );
    assert(
      formatBusinessDate(parsed) === expectedDay,
      `"${input}" displayed ${formatBusinessDate(parsed)}; expected ${expectedDay}`,
    );
    // The sales API must use the same interpretation, not its own.
    const viaApi = parseSaleInput({ customerId: 1, items: [{ productId: 1, quantity: 1 }], soldAt: input });
    assert(
      viaApi.soldAt.toISOString() === expectedIso,
      `sales API stored ${viaApi.soldAt.toISOString()} for "${input}"; expected ${expectedIso}`,
    );
  }

  // Impossible calendar dates stay rejected.
  for (const impossible of ["2026-02-30", "2025-02-29", "2026-13-01"]) {
    let rejected;
    try {
      parseBusinessDateInput(impossible);
    } catch (error) {
      rejected = error;
    }
    assert(rejected, `impossible date ${impossible} was accepted`);
  }

  // ---------------------------------------------------------------
  // Fixtures.
  // ---------------------------------------------------------------
  const alice = await client.customer.create({ data: { name: "Alice Histórico" } });
  const bruno = await client.customer.create({ data: { name: "Bruno Histórico" } });
  const emptyCustomer = await client.customer.create({ data: { name: "Sem Compras" } });

  const makeProduct = (name, days) =>
    client.product.create({
      data: { name, unit: "un", currentStock: 100000, minimumStock: 0, consumptionDays: days },
    });
  const shampoo = await makeProduct("Shampoo", 5);
  const sabonete = await makeProduct("Sabonete", 3);

  const makeSale = (customerId, soldAt, items) =>
    client.sale.create({
      data: { customerId, soldAt, status: "CONFIRMED", items: { create: items } },
      include: { items: true },
    });

  // Same soldAt twice, to force the sale-level tiebreak to matter.
  const sameInstant = new Date("2026-08-10T12:00:00.000Z");
  const aliceA = await makeSale(alice.id, sameInstant, [{ productId: shampoo.id, quantity: 1 }]);
  const aliceB = await makeSale(alice.id, sameInstant, [{ productId: sabonete.id, quantity: 1 }]);
  const aliceNewer = await makeSale(alice.id, new Date("2026-08-15T12:00:00.000Z"), [
    // Two rows of the same product in one sale: legal by direct write, and the
    // reason productId alone is not a total item order.
    { productId: shampoo.id, quantity: 2 },
    { productId: shampoo.id, quantity: 5 },
    { productId: sabonete.id, quantity: 1 },
  ]);
  const brunoSale = await makeSale(bruno.id, new Date("2026-08-16T12:00:00.000Z"), [
    { productId: shampoo.id, quantity: 1 },
  ]);

  // ---------------------------------------------------------------
  // 1-2. Total ordering, sales and items.
  // ---------------------------------------------------------------
  const first = await readCustomerHistory(client, alice.id);
  assert(first.customer.id === alice.id, "history returned the wrong customer");
  const order = first.sales.map((sale) => sale.id);
  assert(
    JSON.stringify(order) === JSON.stringify([aliceNewer.id, Math.max(aliceA.id, aliceB.id), Math.min(aliceA.id, aliceB.id)]),
    `sales order ${order} is not soldAt DESC with an id DESC tiebreak`,
  );

  const multi = first.sales.find((sale) => sale.id === aliceNewer.id);
  const itemOrder = multi.items.map((item) => [item.productId, item.id]);
  const expectedItemOrder = [...itemOrder].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  assert(
    JSON.stringify(itemOrder) === JSON.stringify(expectedItemOrder),
    `items ${JSON.stringify(itemOrder)} are not ordered by productId then id`,
  );
  assert(
    multi.items.filter((item) => item.productId === shampoo.id).length === 2,
    "duplicate-product fixture did not persist two rows",
  );

  // ---------------------------------------------------------------
  // 3. Customer isolation.
  // ---------------------------------------------------------------
  assert(
    first.sales.every((sale) => sale.customerId === alice.id),
    "history leaked another customer's sale",
  );
  const brunoHistory = await readCustomerHistory(client, bruno.id);
  assert(
    brunoHistory.sales.length === 1 && brunoHistory.sales[0].id === brunoSale.id,
    "Bruno's history is wrong",
  );

  // ---------------------------------------------------------------
  // 4. Forecasts follow the canonical formula, NULL shows as absence.
  // ---------------------------------------------------------------
  const forecastItem = multi.items.find((item) => item.productId === sabonete.id);
  assert(
    forecastItem.expectedRepurchaseAt?.getTime() ===
      new Date("2026-08-15T12:00:00.000Z").getTime() + 1 * 3 * DAY_MS,
    `forecast is ${forecastItem.expectedRepurchaseAt?.toISOString()}; expected soldAt + 3 days`,
  );
  assert(formatBusinessDate(null) === "—", "a null forecast must render as an em dash");

  // ---------------------------------------------------------------
  // 5-6. Empty history vs missing customer.
  // ---------------------------------------------------------------
  const empty = await readCustomerHistory(client, emptyCustomer.id);
  assert(empty.sales.length === 0 && empty.nextCursor === null, "empty history is not empty");
  let missing;
  try {
    await readCustomerHistory(client, 2_147_000_000);
  } catch (error) {
    missing = error;
  }
  assert(missing instanceof CustomerHistoryError && missing.kind === "not_found",
    "a missing customer must be distinguishable from an empty history");

  // ---------------------------------------------------------------
  // 7-8. Cursor pagination, including a backdated sale where creation order
  //      contradicts soldAt order -- an id-based seek would break here.
  // ---------------------------------------------------------------
  const backdated = await makeSale(alice.id, new Date("2026-07-01T12:00:00.000Z"), [
    { productId: shampoo.id, quantity: 1 },
  ]);
  assert(backdated.id > aliceNewer.id, "fixture assumption failed: backdated sale should have a higher id");

  const all = await readCustomerHistory(client, alice.id, { limit: MAX_HISTORY_LIMIT });
  const fullOrder = all.sales.map((sale) => sale.id);
  assert(fullOrder.at(-1) === backdated.id, "the backdated sale must sort last, not by id");

  const seen = [];
  let cursor = null;
  for (let page = 0; page < 10; page += 1) {
    const result = await readCustomerHistory(client, alice.id, { limit: 2, cursor });
    seen.push(...result.sales.map((sale) => sale.id));
    cursor = result.nextCursor;
    if (cursor === null) break;
  }
  assert(
    JSON.stringify(seen) === JSON.stringify(fullOrder),
    `paged traversal ${seen} did not reproduce the full order ${fullOrder}`,
  );
  assert(new Set(seen).size === seen.length, "paged traversal duplicated a sale");

  // ---------------------------------------------------------------
  // 9. A cursor belonging to another customer is rejected.
  // ---------------------------------------------------------------
  let foreign;
  try {
    await readCustomerHistory(client, alice.id, { cursor: brunoSale.id });
  } catch (error) {
    foreign = error;
  }
  assert(
    foreign instanceof CustomerHistoryError && foreign.kind === "invalid",
    "a cursor from another customer must be rejected",
  );
  const afterForeign = await readCustomerHistory(client, alice.id, { limit: MAX_HISTORY_LIMIT });
  assert(afterForeign.sales.length === fullOrder.length, "history changed after a rejected cursor");

  // ---------------------------------------------------------------
  // 10. Concurrent inserts, both directions.
  // ---------------------------------------------------------------
  const pageOne = await readCustomerHistory(client, alice.id, { limit: 2 });
  const original = fullOrder;

  const newer = await makeSale(alice.id, new Date("2026-09-01T12:00:00.000Z"), [
    { productId: shampoo.id, quantity: 1 },
  ]);
  const olderInserted = await makeSale(alice.id, new Date("2026-06-01T12:00:00.000Z"), [
    { productId: shampoo.id, quantity: 1 },
  ]);

  const rest = [];
  let midCursor = pageOne.nextCursor;
  for (let page = 0; page < 10 && midCursor !== null; page += 1) {
    const result = await readCustomerHistory(client, alice.id, { limit: 2, cursor: midCursor });
    rest.push(...result.sales.map((sale) => sale.id));
    midCursor = result.nextCursor;
  }
  const traversed = [...pageOne.sales.map((sale) => sale.id), ...rest];

  assert(new Set(traversed).size === traversed.length, "concurrent insert caused a duplicate");
  for (const id of original) {
    assert(traversed.includes(id), `concurrent insert caused sale ${id} to be skipped`);
  }
  assert(!traversed.includes(newer.id), "a newer sale must not appear ahead of the cursor mid-traversal");
  assert(
    traversed.includes(olderInserted.id),
    "a backdated sale inserted behind the cursor is expected to appear -- the asymmetry is declared",
  );

  // ---------------------------------------------------------------
  // 11. limit and cursor validation.
  // ---------------------------------------------------------------
  assert(parseHistoryLimit(null) === 20, "default limit is not 20");
  assert(parseHistoryLimit("50") === 50, "max limit rejected");
  for (const bad of ["0", "51", "-1", "abc", "1.5"]) {
    let rejected;
    try {
      parseHistoryLimit(bad);
    } catch (error) {
      rejected = error;
    }
    assert(rejected, `limit "${bad}" was accepted`);
  }
  for (const bad of ["0", "abc", "-3"]) {
    let rejected;
    try {
      parseHistoryCursor(bad);
    } catch (error) {
      rejected = error;
    }
    assert(rejected, `cursor "${bad}" was accepted`);
  }
  let unknownCursor;
  try {
    await readCustomerHistory(client, alice.id, { cursor: 2_146_000_000 });
  } catch (error) {
    unknownCursor = error;
  }
  assert(unknownCursor instanceof CustomerHistoryError, "an unknown cursor must be rejected");

  // ---------------------------------------------------------------
  // 17. Forecast arithmetic is fixed-duration across a DST transition (L4).
  // ---------------------------------------------------------------
  const dstProduct = await makeProduct("Produto DST", 1);
  const dstSoldAt = parseBusinessDateInput("2019-02-16");
  const dstSale = await makeSale(alice.id, dstSoldAt, [{ productId: dstProduct.id, quantity: 1 }]);
  const dstForecast = dstSale.items[0].expectedRepurchaseAt;
  assert(
    dstForecast.getTime() === dstSoldAt.getTime() + DAY_MS,
    "forecast is not fixed-duration arithmetic",
  );
  assert(
    formatBusinessDate(dstForecast) === "16/02/2019",
    `L4: a one-day forecast on 2019-02-16 displays ${formatBusinessDate(dstForecast)}; the declared behaviour is 16/02/2019`,
  );

  // ---------------------------------------------------------------
  // 18. A row written at midnight UTC before the parsing rule renders by its
  //     stored instant (L3), not by a guessed intent.
  // ---------------------------------------------------------------
  const legacy = await makeSale(alice.id, new Date("2026-05-10T00:00:00.000Z"), [
    { productId: shampoo.id, quantity: 1 },
  ]);
  assert(
    formatBusinessDate(legacy.soldAt) === "09/05/2026",
    `L3: a midnight-UTC row displays ${formatBusinessDate(legacy.soldAt)}; declared behaviour is 09/05/2026`,
  );

  // ---------------------------------------------------------------
  // 19. Renaming a product changes past history (L1).
  // ---------------------------------------------------------------
  await client.product.update({ where: { id: sabonete.id }, data: { name: "Sabonete Renomeado" } });
  const renamed = await readCustomerHistory(client, alice.id, { limit: MAX_HISTORY_LIMIT });
  const renamedItem = renamed.sales
    .flatMap((sale) => sale.items)
    .find((item) => item.productId === sabonete.id);
  assert(
    renamedItem.product.name === "Sabonete Renomeado",
    "L1: history is expected to show the current product name",
  );

  console.log("Customer history tests: PASS");
} catch (error) {
  console.error("Customer history tests: FAIL");
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
} finally {
  if (client) await client.$disconnect();
  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quoteSchemaName(schemaName)} CASCADE`);
  } catch (error) {
    console.error(`Could not drop schema ${schemaName}:`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
  await admin.$disconnect();
}
