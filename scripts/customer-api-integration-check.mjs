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
  if (!condition) {
    throw new Error(message);
  }
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
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json();
  return { body, status: response.status };
}

async function waitForNext(server, url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Next.js exited before the API became ready (code ${server.exitCode})`);
    }

    try {
      const response = await fetch(`${url}/api/customers`, {
        signal: AbortSignal.timeout(2_000),
      });

      if (response.status === 200) {
        return;
      }

      const body = await response.text();
      throw new Error(`Customer API readiness returned HTTP ${response.status}: ${body}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Customer API readiness")) {
        throw error;
      }
    }

    await delay(500);
  }

  throw new Error("Timed out waiting for the Next.js Customer API");
}

function postOptions(body) {
  return { method: "POST", body: JSON.stringify(body) };
}

function putOptions(body) {
  return { method: "PUT", body: JSON.stringify(body) };
}

let nextProcess;
let prisma;

try {
  assert(process.env.DATABASE_URL, "DATABASE_URL is required for the Customer API integration check");

  const port = await findFreePort();
  const url = `${baseUrl}:${port}`;
  nextProcess = spawn(process.execPath, [nextCli, "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: "development" },
    stdio: "inherit",
  });

  await waitForNext(nextProcess, url);

  const firstPhone = `api-check-${suffix}-first`;
  const secondPhone = `api-check-${suffix}-second`;
  const updatedPhone = `api-check-${suffix}-updated`;

  const created = await request(url, "/api/customers", postOptions({
    name: `API Customer ${suffix}`,
    phone: firstPhone,
  }));
  assert(created.status === 201, `valid POST expected 201, received ${created.status}`);
  assert(Number.isInteger(created.body.customer?.id), "valid POST did not return a Customer id");
  assert(created.body.customer.name === `API Customer ${suffix}`, "valid POST returned the wrong name");
  createdIds.push(created.body.customer.id);

  const unicodeWhitespacePost = await request(url, "/api/customers", postOptions({ name: "\u0085" }));
  assert(unicodeWhitespacePost.status === 400, `U+0085-only POST expected 400, received ${unicodeWhitespacePost.status}`);

  const malformedPost = await request(url, "/api/customers", {
    method: "POST",
    body: '{"name":"truncated',
  });
  assert(malformedPost.status === 400, `malformed POST expected 400, received ${malformedPost.status}`);

  const invalid = await request(url, "/api/customers", postOptions({ name: "   " }));
  assert(invalid.status === 400, `blank-name POST expected 400, received ${invalid.status}`);

  const duplicatePost = await request(url, "/api/customers", postOptions({
    name: `API Duplicate ${suffix}`,
    phone: firstPhone,
  }));
  assert(duplicatePost.status === 409, `duplicate-phone POST expected 409, received ${duplicatePost.status}`);

  const second = await request(url, "/api/customers", postOptions({
    name: `Hélio José ${suffix}`,
    phone: secondPhone,
  }));
  assert(second.status === 201, `second valid POST expected 201, received ${second.status}`);
  assert(second.body.customer.name === `Hélio José ${suffix}`, "real Unicode name was not accepted");
  createdIds.push(second.body.customer.id);

  const listed = await request(url, "/api/customers");
  assert(listed.status === 200, `GET /api/customers expected 200, received ${listed.status}`);
  assert(Array.isArray(listed.body.customers), "GET /api/customers did not return a customers array");
  const listedFirst = listed.body.customers.find((customer) => customer.id === created.body.customer.id);
  assert(listedFirst?.name === `API Customer ${suffix}`, "GET did not return the persisted first Customer");
  assert("createdAt" in listedFirst && "updatedAt" in listedFirst, "GET Customer shape lacks timestamps");

  const updated = await request(url, `/api/customers/${created.body.customer.id}`, putOptions({
    name: `API Updated ${suffix}`,
    phone: updatedPhone,
  }));
  assert(updated.status === 200, `valid PUT expected 200, received ${updated.status}`);
  assert(updated.body.customer.phone === updatedPhone, "valid PUT returned the wrong phone");

  const unicodeWhitespacePut = await request(url, `/api/customers/${created.body.customer.id}`, putOptions({
    name: "\u0085",
    phone: updatedPhone,
  }));
  assert(unicodeWhitespacePut.status === 400, `U+0085-only PUT expected 400, received ${unicodeWhitespacePut.status}`);

  const malformedPut = await request(url, `/api/customers/${created.body.customer.id}`, {
    method: "PUT",
    body: '{"name":"truncated',
  });
  assert(malformedPut.status === 400, `malformed PUT expected 400, received ${malformedPut.status}`);

  const duplicatePut = await request(url, `/api/customers/${second.body.customer.id}`, putOptions({
    name: `API Second Conflict ${suffix}`,
    phone: updatedPhone,
  }));
  assert(duplicatePut.status === 409, `duplicate-phone PUT expected 409, received ${duplicatePut.status}`);

  const missing = await request(url, "/api/customers/999999999", putOptions({
    name: `API Missing ${suffix}`,
    phone: `api-check-${suffix}-missing`,
  }));
  assert(missing.status === 404, `missing-customer PUT expected 404, received ${missing.status}`);

  const persisted = await request(url, "/api/customers");
  const persistedFirst = persisted.body.customers.find((customer) => customer.id === created.body.customer.id);
  assert(persistedFirst?.name === `API Updated ${suffix}`, "updated Customer was not persisted through Prisma");
  assert(persistedFirst?.phone === updatedPhone, "updated Customer phone was not persisted through Prisma");

  console.log("Customer API integration: PASS");
} catch (error) {
  console.error("Customer API integration: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (nextProcess) {
    nextProcess.kill("SIGTERM");
  }

  if (createdIds.length > 0 && process.env.DATABASE_URL) {
    prisma = new PrismaClient();
    await prisma.customer.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.$disconnect();
  }
}
