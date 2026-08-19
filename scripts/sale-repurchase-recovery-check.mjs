import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const TASK09_FIRST_MIGRATION = "20260811110000_compute_sale_item_repurchase_forecast";
const repoRoot = process.cwd();
const migrationsRoot = resolve(repoRoot, "prisma", "migrations");
const schemaPath = resolve(repoRoot, "prisma", "schema.prisma");
const migrationCli = resolve(repoRoot, "node_modules", "prisma", "build", "index.js");
const baseUrl = process.env.DATABASE_URL;
const DAY_MS = 24 * 60 * 60 * 1000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function quoteSchemaName(schemaName) {
  assert(/^[a-z0-9_]+$/.test(schemaName), "Generated schema name contains unsafe characters");
  return `"${schemaName}"`;
}

function urlForSchema(schemaName) {
  const url = new URL(baseUrl);
  url.searchParams.set("schema", schemaName);
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

function createPreTask09MigrationProject() {
  const tempRoot = mkdtempSync(join(repoRoot, ".tmp-task09-recovery-"));
  const tempMigrations = join(tempRoot, "migrations");
  mkdirSync(tempMigrations, { recursive: true });
  cpSync(schemaPath, join(tempRoot, "schema.prisma"));
  cpSync(join(migrationsRoot, "migration_lock.toml"), join(tempMigrations, "migration_lock.toml"));

  const migrationDirectories = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+_.+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const targetIndex = migrationDirectories.indexOf(TASK09_FIRST_MIGRATION);
  assert(targetIndex >= 0, `Target migration ${TASK09_FIRST_MIGRATION} was not found`);

  for (const migrationName of migrationDirectories.slice(0, targetIndex)) {
    cpSync(join(migrationsRoot, migrationName), join(tempMigrations, migrationName), { recursive: true });
  }

  return { root: tempRoot, schema: join(tempRoot, "schema.prisma") };
}

if (!baseUrl) {
  console.error("Sale repurchase recovery tests: FAIL");
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const schemaName = `task09_recovery_${Date.now()}_${process.pid}`;
const isolatedUrl = urlForSchema(schemaName);
const admin = new PrismaClient();
const legacyProject = createPreTask09MigrationProject();
let client;
let clientA;
let clientB;

try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA ${quoteSchemaName(schemaName)}`);

  // Build a real pre-TASK-09 database, then insert a row that was legal at
  // that time but whose future forecast cannot be represented by JS Date.
  runMigrations(isolatedUrl, legacyProject.schema);
  client = clientFor(isolatedUrl);

  const customer = await client.customer.create({ data: { name: "TASK-09 recovery legacy customer" } });
  const legacyProduct = await client.product.create({
    data: {
      name: "TASK-09 recovery legacy overflow product",
      unit: "un",
      currentStock: 10,
      minimumStock: 1,
      consumptionDays: 2147483647,
    },
  });
  const legacySoldAt = new Date("2026-08-11T09:00:00.000Z");
  const legacySale = await client.sale.create({
    data: {
      customerId: customer.id,
      soldAt: legacySoldAt,
      status: "MODEL_TEST",
      items: { create: [{ productId: legacyProduct.id, quantity: 1 }] },
    },
    include: { items: true },
  });
  assert(legacySale.items[0].expectedRepurchaseAt === null, "pre-TASK-09 row unexpectedly had a forecast");
  const legacyItemId = legacySale.items[0].id;
  await client.$disconnect();
  client = null;

  // This is the P1 migration-compatibility proof: full TASK-09 deployment
  // must succeed even with that historical row present.
  runMigrations(isolatedUrl, schemaPath);
  client = clientFor(isolatedUrl);
  const legacyAfter = await client.saleItem.findUniqueOrThrow({ where: { id: legacyItemId } });
  assert(
    legacyAfter.expectedRepurchaseAt === null,
    "unrepresentable legacy row should remain NULL rather than block deployment",
  );

  const [legacySafe] = await client.$queryRaw`
    SELECT "compute_legacy_expected_repurchase_at"('2026-01-01'::timestamp(3), 1, 2147483647) AS "value"
  `;
  assert(legacySafe.value === null, "legacy compatibility helper did not return NULL for an unrepresentable forecast");

  let strictError;
  try {
    await client.$queryRaw`SELECT "compute_expected_repurchase_at"('2026-01-01'::timestamp(3), 1, 2147483647)`;
  } catch (caught) {
    strictError = caught;
  }
  assert(strictError, "strict runtime helper accepted an unrepresentable forecast");

  // P1 lock-upgrade proof: two concurrent sales of the same Product must
  // both commit when stock is sufficient. FOR NO KEY UPDATE serializes them
  // before TASK-08's stock UPDATE instead of allowing compatible shared
  // locks that later deadlock during lock upgrade.
  const concurrentProduct = await client.product.create({
    data: {
      name: "TASK-09 concurrent product",
      unit: "un",
      currentStock: 10,
      minimumStock: 1,
      consumptionDays: 5,
    },
  });
  const concurrentCustomer = await client.customer.create({ data: { name: "TASK-09 concurrent customer" } });
  const soldAt = new Date("2026-08-12T00:00:00.000Z");
  clientA = clientFor(isolatedUrl);
  clientB = clientFor(isolatedUrl);

  const [saleA, saleB] = await Promise.all([
    clientA.sale.create({
      data: {
        customerId: concurrentCustomer.id,
        soldAt,
        status: "MODEL_TEST",
        items: { create: [{ productId: concurrentProduct.id, quantity: 1 }] },
      },
      include: { items: true },
    }),
    clientB.sale.create({
      data: {
        customerId: concurrentCustomer.id,
        soldAt,
        status: "MODEL_TEST",
        items: { create: [{ productId: concurrentProduct.id, quantity: 1 }] },
      },
      include: { items: true },
    }),
  ]);

  assert(saleA.id !== saleB.id, "concurrent sales did not both commit");
  const productAfter = await client.product.findUniqueOrThrow({ where: { id: concurrentProduct.id } });
  assert(productAfter.currentStock === 8, `concurrent sales produced stock ${productAfter.currentStock}; expected 8`);
  const expectedForecast = soldAt.getTime() + 5 * DAY_MS;
  assert(saleA.items[0].expectedRepurchaseAt?.getTime() === expectedForecast, "sale A forecast is incorrect");
  assert(saleB.items[0].expectedRepurchaseAt?.getTime() === expectedForecast, "sale B forecast is incorrect");

  console.log("Sale repurchase recovery tests: PASS");
} catch (error) {
  console.error("Sale repurchase recovery tests: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (clientA) await clientA.$disconnect();
  if (clientB) await clientB.$disconnect();
  if (client) await client.$disconnect();
  rmSync(legacyProject.root, { recursive: true, force: true });
  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quoteSchemaName(schemaName)} CASCADE`);
  } catch (error) {
    console.error(`Could not drop isolated schema ${schemaName}:`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
  await admin.$disconnect();
}
