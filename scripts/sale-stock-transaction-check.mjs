import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const repoRoot = process.cwd();
const schemaPath = resolve(repoRoot, "prisma", "schema.prisma");
const migrationCli = resolve(repoRoot, "node_modules", "prisma", "build", "index.js");

function loadLocalEnvironment() {
  if (process.env.DATABASE_URL || !existsSync(join(process.cwd(), ".env"))) {
    return;
  }

  for (const line of readFileSync(join(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);

    if (!match || match[1] in process.env) {
      continue;
    }

    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertRejected(operation, label) {
  let error;

  try {
    await operation();
  } catch (caught) {
    error = caught;
  }

  assert(error, `${label} was accepted`);
}

function quoteSchemaName(schemaName) {
  assert(/^[a-z0-9_]+$/.test(schemaName), "Generated schema name contains unsafe characters");
  return `"${schemaName}"`;
}

function runMigrations(targetUrl) {
  assert(existsSync(migrationCli), `Prisma CLI not found at ${migrationCli}`);

  const result = spawnSync(
    process.execPath,
    [migrationCli, "migrate", "deploy", "--schema", schemaPath],
    {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: targetUrl },
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }

  assert(result.status === 0, `Migration deploy failed with exit code ${result.status}`);
}

loadLocalEnvironment();

if (!process.env.DATABASE_URL) {
  console.error("Sale stock transaction tests: FAIL");
  console.error("DATABASE_URL is not set. Copy .env.example to .env or export DATABASE_URL.");
  process.exit(1);
}

const suffix = `${Date.now()}-${process.pid}`;
const schemaName = `sale_stock_check_${Date.now()}_${process.pid}`;
const isolatedUrl = new URL(process.env.DATABASE_URL);
isolatedUrl.searchParams.set("schema", schemaName);
const admin = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: isolatedUrl.toString() } } });
let customerId;

async function makeProduct(stock) {
  const product = await prisma.product.create({
    data: {
      name: `TASK-08 Product ${suffix}-${stock}-${Math.random().toString(36).slice(2, 7)}`,
      unit: "un",
      currentStock: stock,
      minimumStock: 1,
      consumptionDays: 30,
    },
  });
  return product.id;
}

try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA ${quoteSchemaName(schemaName)}`);
  runMigrations(isolatedUrl.toString());

  const customer = await prisma.customer.create({ data: { name: `TASK-08 Customer ${suffix}` } });
  customerId = customer.id;
  const soldAt = new Date("2026-08-10T12:00:00.000Z");

  // Case A: a sale reduces stock atomically for every item.
  {
    const productAId = await makeProduct(10);
    const productBId = await makeProduct(5);

    await prisma.sale.create({
      data: {
        customerId,
        soldAt,
        status: "MODEL_TEST",
        items: {
          create: [
            { productId: productAId, quantity: 3 },
            { productId: productBId, quantity: 2 },
          ],
        },
      },
    });

    const [productA, productB] = await Promise.all([
      prisma.product.findUniqueOrThrow({ where: { id: productAId } }),
      prisma.product.findUniqueOrThrow({ where: { id: productBId } }),
    ]);
    assert(productA.currentStock === 7, "stock was not reduced by the sold quantity");
    assert(productB.currentStock === 3, "stock was not reduced for the second item");
  }

  // Case B: a single item that would drive stock negative is rejected, and
  // nothing about the sale (or any other item's stock) is persisted.
  {
    const productAId = await makeProduct(2);
    const productBId = await makeProduct(10);
    const salesBefore = await prisma.sale.count();

    await assertRejected(
      () =>
        prisma.sale.create({
          data: {
            customerId,
            soldAt,
            status: "MODEL_TEST",
            items: {
              create: [
                { productId: productBId, quantity: 4 },
                { productId: productAId, quantity: 3 },
              ],
            },
          },
        }),
      "sale with one item exceeding available stock",
    );

    const [productA, productB, salesAfter] = await Promise.all([
      prisma.product.findUniqueOrThrow({ where: { id: productAId } }),
      prisma.product.findUniqueOrThrow({ where: { id: productBId } }),
      prisma.sale.count(),
    ]);
    assert(productA.currentStock === 2, "insufficient-stock item's product was still reduced");
    assert(productB.currentStock === 10, "sibling item's stock was reduced despite the transaction failing");
    assert(salesAfter === salesBefore, "Sale row persisted despite a rejected item");
  }

  // Case C: stock can reach exactly zero, but not go below it.
  {
    const productId = await makeProduct(4);

    await prisma.sale.create({
      data: {
        customerId,
        soldAt,
        status: "MODEL_TEST",
        items: { create: [{ productId, quantity: 4 }] },
      },
    });
    const atZero = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    assert(atZero.currentStock === 0, "stock did not reach exactly zero");

    await assertRejected(
      () =>
        prisma.sale.create({
          data: {
            customerId,
            soldAt,
            status: "MODEL_TEST",
            items: { create: [{ productId, quantity: 1 }] },
          },
        }),
      "sale against a product already at zero stock",
    );
    const stillZero = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    assert(stillZero.currentStock === 0, "stock went negative");
  }

  // Case D: direct negative stock is rejected even outside the Sale flow,
  // proving the invariant is enforced by the database, not application code.
  {
    const productId = await makeProduct(1);
    await assertRejected(
      () => prisma.product.update({ where: { id: productId }, data: { currentStock: -1 } }),
      "direct update setting currentStock negative",
    );
  }

  // Case E: two concurrent sales for the same product, each individually
  // valid against the starting stock but not together, must not both
  // succeed - exactly one commits, the other is rejected, and stock never
  // goes negative. This is Prisma's default READ COMMITTED, exercising the
  // same UPDATE-based row-locking correctness proven for Sale in TASK-07.
  {
    const productId = await makeProduct(10);

    const attemptA = prisma.sale.create({
      data: {
        customerId,
        soldAt,
        status: "MODEL_TEST",
        items: { create: [{ productId, quantity: 6 }] },
      },
    });
    const attemptB = prisma.sale.create({
      data: {
        customerId,
        soldAt,
        status: "MODEL_TEST",
        items: { create: [{ productId, quantity: 6 }] },
      },
    });

    const outcomes = await Promise.allSettled([attemptA, attemptB]);
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected").length;
    assert(rejected === 1, "concurrent overlapping sales for the same product did not conflict as expected");

    const finalProduct = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    assert(finalProduct.currentStock === 4, "concurrent sales left stock at an unexpected value");
  }

  console.log("Sale stock transaction tests: PASS");
} catch (error) {
  console.error("Sale stock transaction tests: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quoteSchemaName(schemaName)} CASCADE`);
  } catch (error) {
    console.error(`Could not drop isolated schema ${schemaName}:`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
  await admin.$disconnect();
}
