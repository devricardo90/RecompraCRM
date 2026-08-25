import { createServer } from "node:net";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

/**
 * Exercises the real `GET /api/repurchases` handler over HTTP.
 *
 * The database harness proves the classification and the trigger-owned
 * freshness, but it drives the projection directly. Nothing was calling the
 * route itself, so the method guard, the failure status and the exact response
 * shape were untested -- the same "testing a private reimplementation" trap
 * TASK-10 recorded a rule against.
 */
const repoRoot = process.cwd();
const nextCli = resolve(repoRoot, "node_modules", "next", "dist", "bin", "next");
const baseUrl = "http://127.0.0.1";
const suffix = `${Date.now()}-${process.pid}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function findFreePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert(address && typeof address === "object", "Could not determine a free TCP port");
  const port = address.port;
  await new Promise((resolvePromise, reject) => server.close((error) => (error ? reject(error) : resolvePromise())));
  return port;
}

async function waitForNext(server, url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Next.js exited before readiness (code ${server.exitCode})`);
    try {
      const response = await fetch(`${url}/api/repurchases`, { signal: AbortSignal.timeout(2_000) });
      if (response.status === 200) return;
      throw new Error(`Repurchase API readiness returned HTTP ${response.status}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Repurchase API readiness")) throw error;
    }
    await delay(500);
  }
  throw new Error("Timed out waiting for the Next.js Repurchase API");
}

let nextProcess;
let prisma;
const createdSaleIds = [];
const createdProductIds = [];
const createdCustomerIds = [];

try {
  assert(process.env.DATABASE_URL, "DATABASE_URL is required for the Repurchase API integration check");
  prisma = new PrismaClient();

  const { UPCOMING_WINDOW_DAYS } = await import("../lib/sales/repurchaseForecast.ts");
  const { businessDayNumber, parseBusinessDateInput } = await import("../lib/format/businessDate.ts");

  const port = await findFreePort();
  const url = `${baseUrl}:${port}`;
  nextProcess = spawn(process.execPath, [nextCli, "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: "development" },
    stdio: "inherit",
  });
  await waitForNext(nextProcess, url);

  // AC16: only GET is served. A read projection that quietly accepts a write
  // method is a write surface nobody declared.
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const response = await fetch(`${url}/api/repurchases`, { method, signal: AbortSignal.timeout(10_000) });
    assert(response.status === 405, `AC16: ${method} /api/repurchases expected 405, received ${response.status}`);
  }

  const soldAt = parseBusinessDateInput("2026-01-05T09:00");
  const today = businessDayNumber(new Date());
  const soldDay = businessDayNumber(soldAt);

  const customer = await prisma.customer.create({
    data: { name: `API Recompra ${suffix}`, phone: `+55119${String(Date.now()).slice(-8)}` },
  });
  createdCustomerIds.push(customer.id);
  const phoneless = await prisma.customer.create({ data: { name: `API Sem telefone ${suffix}` } });
  createdCustomerIds.push(phoneless.id);

  const makeProduct = async (label, offset) => {
    const product = await prisma.product.create({
      data: {
        name: `API ${label} ${suffix}`,
        unit: "un",
        currentStock: 1000,
        minimumStock: 0,
        consumptionDays: today + offset - soldDay,
      },
    });
    createdProductIds.push(product.id);
    return product;
  };

  const overdue = await makeProduct("vencida", -2);
  const todayProduct = await makeProduct("hoje", 0);
  const daySeven = await makeProduct("dia-sete", UPCOMING_WINDOW_DAYS);
  const dayEight = await makeProduct("dia-oito", UPCOMING_WINDOW_DAYS + 1);

  const sale = await prisma.sale.create({
    data: {
      customerId: customer.id,
      soldAt,
      status: "CONFIRMED",
      items: {
        create: [
          { productId: overdue.id, quantity: 1 },
          { productId: todayProduct.id, quantity: 1 },
          { productId: daySeven.id, quantity: 1 },
          { productId: dayEight.id, quantity: 1 },
        ],
      },
    },
    include: { items: true },
  });
  createdSaleIds.push(sale.id);

  const phonelessSale = await prisma.sale.create({
    data: {
      customerId: phoneless.id,
      soldAt,
      status: "CONFIRMED",
      items: { create: [{ productId: todayProduct.id, quantity: 1 }] },
    },
    include: { items: true },
  });
  createdSaleIds.push(phonelessSale.id);

  const response = await fetch(`${url}/api/repurchases`, { signal: AbortSignal.timeout(20_000) });
  assert(response.status === 200, `GET /api/repurchases expected 200, received ${response.status}`);
  const payload = await response.json();

  // Response shape, from the route rather than from a copy of it.
  assert(typeof payload.generatedAt === "string", "the response must carry generatedAt");
  assert(Number.isFinite(Date.parse(payload.generatedAt)), "generatedAt must be an instant");
  for (const bucket of ["overdue", "today", "upcoming"]) {
    assert(Number.isInteger(payload.counts?.[bucket]), `counts.${bucket} must be an integer`);
  }
  assert(Array.isArray(payload.items), "items must be an array");

  const idFor = (productId) => sale.items.find((item) => item.productId === productId)?.id;
  const bucketFor = (productId) =>
    payload.items.find((item) => item.saleItemId === idFor(productId))?.bucket ?? null;

  assert(bucketFor(overdue.id) === "overdue", "AC1: a past forecast must come back overdue");
  assert(bucketFor(todayProduct.id) === "today", "AC2: today's forecast must come back today");
  assert(bucketFor(daySeven.id) === "upcoming", "AC4: day seven must be inside the window");
  assert(bucketFor(dayEight.id) === null, "AC4: day eight must not be returned");

  // AC7: the summary the route emits cannot disagree with the list it emits.
  const counted = { overdue: 0, today: 0, upcoming: 0 };
  for (const item of payload.items) counted[item.bucket] += 1;
  for (const bucket of ["overdue", "today", "upcoming"]) {
    assert(
      counted[bucket] === payload.counts[bucket],
      `AC7: counts.${bucket} is ${payload.counts[bucket]} but the list holds ${counted[bucket]}`,
    );
  }

  // AC8: ordering is total and stable across identical reads.
  const ordering = payload.items.map((item) => `${item.bucket}:${item.expectedRepurchaseAt}:${item.saleItemId}`);
  const second = await (await fetch(`${url}/api/repurchases`, { signal: AbortSignal.timeout(20_000) })).json();
  assert(
    JSON.stringify(second.items.map((item) => `${item.bucket}:${item.expectedRepurchaseAt}:${item.saleItemId}`))
      === JSON.stringify(ordering),
    "AC8: two identical reads must return the same order",
  );

  // AC21: an absent phone is an explicit null, and the key is always present.
  const phonelessItem = payload.items.find((item) => item.customer.id === phoneless.id);
  assert(phonelessItem, "the phoneless customer's forecast should be listed");
  assert("phone" in phonelessItem.customer, "AC21: the phone key must always be present");
  assert(phonelessItem.customer.phone === null, "AC21: a customer without a phone must expose null");

  const withPhone = payload.items.find((item) => item.customer.id === customer.id);
  assert(typeof withPhone.customer.phone === "string", "AC21: a stored phone must come back as a string");

  console.log("Repurchase API integration tests: PASS");
} catch (error) {
  console.error("Repurchase API integration tests: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (prisma) {
    for (const id of createdSaleIds) {
      await prisma.saleItem.deleteMany({ where: { saleId: id } }).catch(() => {});
      await prisma.sale.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdProductIds) await prisma.product.delete({ where: { id } }).catch(() => {});
    for (const id of createdCustomerIds) await prisma.customer.delete({ where: { id } }).catch(() => {});
    await prisma.$disconnect();
  }
  nextProcess?.kill("SIGTERM");
}
