import { createServer } from "node:net";
import { resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

/**
 * TASK-15: the six stages of the MVP chain, end to end, through the real HTTP
 * routes.
 *
 * Every other check in this repository proves one slice and stops. None of
 * them creates a customer, sells a product to them, and then confirms that
 * *that* customer reaches the forecast and the dashboard. The seam between the
 * slices is what this proves.
 *
 * It runs in a schema of its own, created here and dropped at the end, because
 * the rows it creates cannot be deleted: `Sale_deletion_blocked` raises on
 * every DELETE on Sale, deliberately, since stock restoration has no policy
 * (TASK-08). Dropping the schema removes the table together with its trigger,
 * so `public` is never read or written and data safety is structural rather
 * than a matter of discipline. See docs/specs/TASK-15.md.
 */

const repoRoot = process.cwd();
const nextCli = resolve(repoRoot, "node_modules", "next", "dist", "bin", "next");
const suffix = `${Date.now()}_${process.pid}`;
const schema = `task15_${suffix}`;

function assert(condition, stage, message) {
  if (!condition) throw new Error(`[${stage}] ${message}`);
}

function withSchema(url, name) {
  const parsed = new URL(url);
  parsed.searchParams.set("schema", name);
  return parsed.toString();
}

async function findFreePort() {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const { port } = server.address();
  await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
  return port;
}

async function waitForNext(server, baseUrl) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Next.js exited before readiness (code ${server.exitCode})`);
    try {
      const response = await fetch(`${baseUrl}/api/products`, { signal: AbortSignal.timeout(2_000) });
      if (response.status === 200) return;
    } catch {
      // not listening yet
    }
    await delay(500);
  }
  throw new Error("Timed out waiting for the Next.js server");
}

async function postJson(baseUrl, path, body, stage) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null);
  assert(
    response.status === 201,
    stage,
    `POST ${path} expected 201, received ${response.status}: ${JSON.stringify(payload)}`,
  );
  return payload;
}

async function getJson(baseUrl, path, stage) {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(20_000) });
  assert(response.status === 200, stage, `GET ${path} expected 200, received ${response.status}`);
  return response.json();
}

function daysFrom(reference, days) {
  return new Date(reference.getTime() + days * 86_400_000);
}

// Classification is over business days, not instants (see businessDayNumber),
// so the two sales are separated by whole days with margin: a run near
// midnight must not move either one across its bucket boundary.
const CONSUMPTION_DAYS = 10;
const INITIAL_STOCK = 100;
// The same quantity on both sales, and greater than one. Greater than one so
// the quantity x consumptionDays product is exercised rather than the
// degenerate quantity = 1; the *same* on both because quantity also moves the
// forecast date, so varying it would mean soldAt was not the only variable and
// the classification could not be attributed to soldAt alone.
const SALE_QUANTITY = 2;

let nextProcess;
let prisma;
let adminPrisma;
let schemaCreated = false;

try {
  const baseDatabaseUrl = process.env.DATABASE_URL;
  assert(baseDatabaseUrl, "setup", "DATABASE_URL is required for the TASK-15 end-to-end check");

  const scopedUrl = withSchema(baseDatabaseUrl, schema);

  // The admin client talks to the original schema only to create and drop the
  // scoped one; it never reads or writes application tables there.
  adminPrisma = new PrismaClient({ datasources: { db: { url: baseDatabaseUrl } } });
  await adminPrisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;

  // Resolved to the local binary rather than shelling out through `npx`:
  // `shell: true` would concatenate rather than escape the arguments, and the
  // schema name is interpolated into this command's environment.
  const prismaCli = resolve(repoRoot, "node_modules", "prisma", "build", "index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: scopedUrl },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  nextProcess = spawn(process.execPath, [nextCli, "dev", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: scopedUrl },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForNext(nextProcess, baseUrl);

  prisma = new PrismaClient({ datasources: { db: { url: scopedUrl } } });

  // --- stage 1: cliente -------------------------------------------------
  const customerPayload = await postJson(
    baseUrl,
    "/api/customers",
    { name: `E2E Cliente ${suffix}`, phone: `11${String(Date.now()).slice(-9)}` },
    "cliente",
  );
  const customer = customerPayload?.customer;
  assert(customer?.id, "cliente", `POST /api/customers did not return the created record: ${JSON.stringify(customerPayload)}`);

  // --- stage 2: produto -------------------------------------------------
  const productPayload = await postJson(
    baseUrl,
    "/api/products",
    {
      name: `E2E Produto ${suffix}`,
      unit: "un",
      currentStock: INITIAL_STOCK,
      minimumStock: 1,
      consumptionDays: CONSUMPTION_DAYS,
    },
    "produto",
  );
  const product = productPayload?.product;
  assert(product?.id, "produto", `POST /api/products did not return the created record: ${JSON.stringify(productPayload)}`);
  assert(
    product.consumptionDays === CONSUMPTION_DAYS,
    "produto",
    `consumptionDays round-tripped as ${product.consumptionDays}, expected ${CONSUMPTION_DAYS}`,
  );

  // --- stage 3: vendas --------------------------------------------------
  // Only soldAt varies between the two: consumptionDays belongs to Product,
  // and this chain deliberately uses a single product.
  // Both forecasts are soldAt + 2 x 10 = 20 days out, so only soldAt decides
  // the bucket: -40 lands ~20 days in the past, -17 lands ~3 days ahead.
  const now = new Date();
  const overdueSoldAt = daysFrom(now, -40);
  const upcomingSoldAt = daysFrom(now, -17);

  const overdueSale = (await postJson(
    baseUrl,
    "/api/sales",
    {
      customerId: customer.id,
      items: [{ productId: product.id, quantity: SALE_QUANTITY }],
      soldAt: overdueSoldAt.toISOString(),
    },
    "venda",
  ))?.sale;
  assert(overdueSale?.id, "venda", "POST /api/sales did not return the overdue sale");

  const upcomingSale = (await postJson(
    baseUrl,
    "/api/sales",
    {
      customerId: customer.id,
      items: [{ productId: product.id, quantity: SALE_QUANTITY }],
      soldAt: upcomingSoldAt.toISOString(),
    },
    "venda",
  ))?.sale;
  assert(upcomingSale?.id, "venda", "POST /api/sales did not return the upcoming sale");

  // --- stage 4: estoque -------------------------------------------------
  // There is no GET /api/products/[id]: that route exports only PUT. The
  // listing is read and the created product selected by id.
  const productsAfter = await getJson(baseUrl, "/api/products", "estoque");
  const productAfter = (productsAfter?.products ?? []).find((entry) => entry.id === product.id);
  assert(productAfter, "estoque", "the created product is missing from GET /api/products");
  const expectedStock = INITIAL_STOCK - 2 * SALE_QUANTITY;
  assert(
    productAfter.currentStock === expectedStock,
    "estoque",
    `stock is ${productAfter.currentStock}, expected exactly ${expectedStock} (${INITIAL_STOCK} - 2 x ${SALE_QUANTITY})`,
  );

  // --- stage 5: previsão ------------------------------------------------
  // expectedRepurchaseAt is a column on SaleItem, not on Sale, and AC6 names
  // where it is read: `sale.items[].expectedRepurchaseAt` in the POST
  // response. Asserting only the database row would let this pass even if the
  // route stopped returning the forecast, or returned a stale one, which is
  // precisely the seam this task exists to cover.
  for (const [label, sale, soldAt] of [
    ["overdue", overdueSale, overdueSoldAt],
    ["upcoming", upcomingSale, upcomingSoldAt],
  ]) {
    const expected = daysFrom(soldAt, SALE_QUANTITY * CONSUMPTION_DAYS);

    const returnedItems = Array.isArray(sale.items) ? sale.items : [];
    assert(
      returnedItems.length === 1,
      "previsao",
      `${label}: POST /api/sales returned ${returnedItems.length} items, expected 1`,
    );
    const returned = returnedItems[0]?.expectedRepurchaseAt;
    assert(
      typeof returned === "string" && !Number.isNaN(Date.parse(returned)),
      "previsao",
      `${label}: the sales route did not return expectedRepurchaseAt on the item (got ${JSON.stringify(returned)})`,
    );
    assert(
      Math.abs(Date.parse(returned) - expected.getTime()) < 1000,
      "previsao",
      `${label}: the route returned ${returned}, expected ${expected.toISOString()} (soldAt + ${SALE_QUANTITY} x ${CONSUMPTION_DAYS} days)`,
    );

    // The persisted row is then cross-checked against what the route said, so
    // a route that computes its own answer instead of reading the trigger's
    // would still fail here.
    const rows = await prisma.saleItem.findMany({ where: { saleId: sale.id } });
    assert(rows.length === 1, "previsao", `${label} sale should have exactly one item row, found ${rows.length}`);
    const persisted = rows[0].expectedRepurchaseAt;
    assert(
      persisted instanceof Date,
      "previsao",
      `${label}: persisted expectedRepurchaseAt is ${persisted}; the trigger should have filled it synchronously`,
    );
    assert(
      Math.abs(persisted.getTime() - Date.parse(returned)) < 1000,
      "previsao",
      `${label}: the route returned ${returned} but the row holds ${persisted.toISOString()}`,
    );
  }

  // --- stage 6: dashboard -----------------------------------------------
  const dashboard = await getJson(baseUrl, "/api/repurchases", "dashboard");
  const mine = (dashboard?.items ?? []).filter((entry) => entry.customer?.id === customer.id);
  assert(
    mine.length === 2,
    "dashboard",
    `GET /api/repurchases returned ${mine.length} rows for the created customer, expected 2`,
  );
  const buckets = mine.map((entry) => entry.bucket).sort();
  assert(
    buckets.includes("overdue"),
    "dashboard",
    `no overdue row for the created customer; buckets were ${JSON.stringify(buckets)}`,
  );
  assert(
    buckets.includes("upcoming") || buckets.includes("today"),
    "dashboard",
    `no upcoming/today row for the created customer; buckets were ${JSON.stringify(buckets)}`,
  );
  assert(
    new Set(buckets).size === 2,
    "dashboard",
    `both sales classified into the same bucket (${JSON.stringify(buckets)}); the two soldAt values must land on business days on opposite sides of the boundary`,
  );

  // --- volta: histórico do cliente --------------------------------------
  const history = await getJson(baseUrl, `/api/customers/${customer.id}/sales`, "historico");
  const historyIds = (history?.sales ?? []).map((sale) => sale.id);
  for (const [label, sale] of [["overdue", overdueSale], ["upcoming", upcomingSale]]) {
    assert(
      historyIds.includes(sale.id),
      "historico",
      `the ${label} sale ${sale.id} is missing from the customer history (got ${JSON.stringify(historyIds)})`,
    );
  }

  console.log("TASK-15 end-to-end chain: PASS");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  nextProcess?.kill("SIGTERM");
  await prisma?.$disconnect();

  if (adminPrisma) {
    if (schemaCreated) {
      // Deliberately not swallowed: a drop that fails silently is how the
      // other integration checks came to leave rows behind for months.
      try {
        await adminPrisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      } catch (dropError) {
        console.error(`[cleanup] failed to drop schema ${schema}: ${dropError instanceof Error ? dropError.message : dropError}`);
        process.exitCode = 1;
      }
    }
    await adminPrisma.$disconnect();
  }
}
