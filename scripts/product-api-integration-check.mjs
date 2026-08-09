import { createServer } from "node:net";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

const repoRoot = process.cwd();
const nextCli = resolve(repoRoot, "node_modules", "next", "dist", "bin", "next");
const baseUrl = "http://127.0.0.1";
const suffix = `${Date.now()}-${process.pid}`;
const createdIds = [];

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

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(10_000),
  });
  return { body: await response.json(), status: response.status };
}

async function waitForNext(server, url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Next.js exited before Product API readiness (code ${server.exitCode})`);

    try {
      const response = await fetch(`${url}/api/products`, { signal: AbortSignal.timeout(2_000) });
      if (response.status === 200) return;
      throw new Error(`Product API readiness returned HTTP ${response.status}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Product API readiness")) throw error;
    }

    await delay(500);
  }

  throw new Error("Timed out waiting for the Next.js Product API");
}

const postOptions = (body) => ({ method: "POST", body: JSON.stringify(body) });
const putOptions = (body) => ({ method: "PUT", body: JSON.stringify(body) });

let nextProcess;
let prisma;

try {
  assert(process.env.DATABASE_URL, "DATABASE_URL is required for the Product API integration check");

  const port = await findFreePort();
  const url = `${baseUrl}:${port}`;
  nextProcess = spawn(process.execPath, [nextCli, "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: "development" },
    stdio: "inherit",
  });

  await waitForNext(nextProcess, url);

  const valid = await request(url, "/api/products", postOptions({
    name: `API Product ${suffix}`,
    unit: "un",
    currentStock: 10,
    minimumStock: 2,
    consumptionDays: 30,
  }));
  assert(valid.status === 201, `valid Product POST expected 201, received ${valid.status}`);
  assert(Number.isInteger(valid.body.product?.id), "valid Product POST did not return an id");
  assert(valid.body.product.currentStock === 10, "valid Product POST returned wrong current stock");
  createdIds.push(valid.body.product.id);

  const invalid = await request(url, "/api/products", postOptions({
    name: " ", unit: "un", currentStock: 0, minimumStock: 0, consumptionDays: 1,
  }));
  assert(invalid.status === 400, `blank Product name expected 400, received ${invalid.status}`);

  const negative = await request(url, "/api/products", postOptions({
    name: "Invalid", unit: "un", currentStock: -1, minimumStock: 0, consumptionDays: 1,
  }));
  assert(negative.status === 400, `negative stock expected 400, received ${negative.status}`);

  const blankCurrentStock = await request(url, "/api/products", postOptions({
    name: "Blank current stock", unit: "un", currentStock: "", minimumStock: 0, consumptionDays: 1,
  }));
  assert(blankCurrentStock.status === 400, `blank current stock expected 400, received ${blankCurrentStock.status}`);

  const blankMinimumStock = await request(url, "/api/products", postOptions({
    name: "Blank minimum stock", unit: "un", currentStock: 0, minimumStock: "", consumptionDays: 1,
  }));
  assert(blankMinimumStock.status === 400, `blank minimum stock expected 400, received ${blankMinimumStock.status}`);

  const listed = await request(url, "/api/products");
  assert(listed.status === 200 && Array.isArray(listed.body.products), "Product GET did not return products");
  const listedProduct = listed.body.products.find((product) => product.id === valid.body.product.id);
  assert(listedProduct?.name === `API Product ${suffix}`, "Product GET did not return persisted product");

  const updated = await request(url, `/api/products/${valid.body.product.id}`, putOptions({
    name: `API Low Stock ${suffix}`,
    unit: "un",
    currentStock: 1,
    minimumStock: 2,
    consumptionDays: 45,
  }));
  assert(updated.status === 200, `valid Product PUT expected 200, received ${updated.status}`);
  assert(updated.body.product.currentStock === 1, "Product PUT returned wrong current stock");

  const missing = await request(url, "/api/products/999999999", putOptions({
    name: "Missing", unit: "un", currentStock: 1, minimumStock: 0, consumptionDays: 1,
  }));
  assert(missing.status === 404, `missing Product PUT expected 404, received ${missing.status}`);

  const persisted = await request(url, "/api/products");
  const persistedProduct = persisted.body.products.find((product) => product.id === valid.body.product.id);
  assert(persistedProduct?.name === `API Low Stock ${suffix}`, "Product update was not persisted through Prisma");
  assert(persistedProduct.currentStock <= persistedProduct.minimumStock, "low-stock state was not persisted");

  console.log("Product API integration: PASS");
} catch (error) {
  console.error("Product API integration: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (nextProcess) nextProcess.kill("SIGTERM");
  if (createdIds.length > 0 && process.env.DATABASE_URL) {
    prisma = new PrismaClient();
    await prisma.product.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.$disconnect();
  }
}
