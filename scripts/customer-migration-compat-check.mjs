import { randomBytes } from "node:crypto";
import { existsSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const NEW_MIGRATION = "20260806204721_enforce_customer_name";
const repoRoot = process.cwd();
const migrationsRoot = resolve(repoRoot, "prisma", "migrations");
const schemaPath = resolve(repoRoot, "prisma", "schema.prisma");
const migrationCli = resolve(repoRoot, "node_modules", "prisma", "build", "index.js");
const baseUrl = process.env.DATABASE_URL;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function databaseUrlFor(databaseName) {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function quoteDatabaseName(databaseName) {
  assert(/^[a-z0-9_]+$/.test(databaseName), "Generated database name contains unsafe characters");
  return `"${databaseName}"`;
}

function makeDatabaseName(label) {
  return `recompra_compat_${label}_${Date.now()}_${process.pid}_${randomBytes(3).toString("hex")}`;
}

function createClient(url) {
  return new PrismaClient({ datasources: { db: { url } } });
}

async function createDatabase(admin, databaseName) {
  await admin.$executeRawUnsafe(`CREATE DATABASE ${quoteDatabaseName(databaseName)}`);
}

async function dropDatabase(admin, databaseName) {
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quoteDatabaseName(databaseName)} WITH (FORCE)`);
}

function runMigrations(targetUrl, targetSchemaPath) {
  assert(existsSync(migrationCli), `Prisma CLI not found at ${migrationCli}`);

  const result = spawnSync(
    process.execPath,
    [migrationCli, "migrate", "deploy", "--schema", targetSchemaPath],
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

function createLegacyMigrationProject() {
  const tempRoot = mkdtempSync(join(repoRoot, ".tmp-customer-migration-compat-"));
  const tempMigrations = join(tempRoot, "migrations");
  mkdirSync(tempMigrations, { recursive: true });

  cpSync(schemaPath, join(tempRoot, "schema.prisma"));
  cpSync(join(migrationsRoot, "migration_lock.toml"), join(tempMigrations, "migration_lock.toml"));

  const migrationDirectories = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+_.+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const targetIndex = migrationDirectories.indexOf(NEW_MIGRATION);

  assert(targetIndex >= 0, `Target migration ${NEW_MIGRATION} was not found`);

  for (const migrationName of migrationDirectories.slice(0, targetIndex)) {
    cpSync(join(migrationsRoot, migrationName), join(tempMigrations, migrationName), { recursive: true });
  }

  return { root: tempRoot, schema: join(tempRoot, "schema.prisma") };
}

async function assertNameRejected(client, name, label) {
  let created;
  let error;

  try {
    created = await client.customer.create({
      data: { name },
    });
  } catch (caught) {
    error = caught;
  }

  assert(!created && error, `${label} was accepted`);
}

async function readNameConstraint(client) {
  const [constraint] = await client.$queryRaw`
    SELECT convalidated AS "validated", pg_get_constraintdef(oid) AS "definition"
    FROM pg_constraint
    WHERE conrelid = '"Customer"'::regclass
      AND conname = 'Customer_name_not_blank'
  `;

  assert(constraint, "Customer_name_not_blank does not exist");
  return constraint;
}

async function runCleanScenario(admin, databaseName) {
  const targetUrl = databaseUrlFor(databaseName);
  await createDatabase(admin, databaseName);
  runMigrations(targetUrl, schemaPath);

  const client = createClient(targetUrl);
  try {
    const constraint = await readNameConstraint(client);
    assert(constraint.validated === true, "Clean database constraint is not VALIDATED");

    const customer = await client.customer.create({ data: { name: "Clean Customer" } });
    assert(customer.name === "Clean Customer", "Normal clean customer was not persisted");

    await assertNameRejected(client, "", "clean empty name");
    await assertNameRejected(client, "   ", "clean space-only name");
    await assertNameRejected(client, "\t\t", "clean tab-only name");
    await assertNameRejected(client, "\n\r\t", "clean line-break-only name");

    console.log("Migration compatibility scenario A (clean database): PASS");
  } finally {
    await client.$disconnect();
  }
}

async function runLegacyScenario(admin, databaseName) {
  const targetUrl = databaseUrlFor(databaseName);
  const legacyProject = createLegacyMigrationProject();
  await createDatabase(admin, databaseName);

  try {
    runMigrations(targetUrl, legacyProject.schema);

    const beforeClient = createClient(targetUrl);
    let legacyCustomer;
    try {
      [legacyCustomer] = await beforeClient.$queryRaw`
        INSERT INTO "Customer" ("name", "createdAt", "updatedAt")
        VALUES ('   ', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING "id", "name"
      `;
    } finally {
      await beforeClient.$disconnect();
    }

    runMigrations(targetUrl, schemaPath);

    const client = createClient(targetUrl);
    try {
      const constraint = await readNameConstraint(client);
      assert(constraint.validated === false, "Legacy invalid data unexpectedly validated the constraint");

      const [legacyAfter] = await client.$queryRaw`
        SELECT "id", "name"
        FROM "Customer"
        WHERE "id" = ${legacyCustomer.id}
      `;
      assert(legacyAfter?.id === legacyCustomer.id, "Legacy customer was deleted");
      assert(legacyAfter.name === "   ", "Legacy customer name was changed");

      await assertNameRejected(client, "", "legacy empty name");
      await assertNameRejected(client, "   ", "legacy space-only name");
      await assertNameRejected(client, "\t\t", "legacy tab-only name");
      await assertNameRejected(client, "\n\r\t", "legacy line-break-only name");

      const normalCustomer = await client.customer.create({ data: { name: "New Normal Customer" } });
      assert(normalCustomer.name === "New Normal Customer", "Normal legacy-database customer was not persisted");

      console.log("Migration compatibility scenario B (legacy database): PASS");
      console.log("Legacy invalid row preserved; Customer_name_not_blank remains NOT VALID.");
    } finally {
      await client.$disconnect();
    }
  } finally {
    rmSync(legacyProject.root, { recursive: true, force: true });
  }
}

if (!baseUrl) {
  console.error("Migration compatibility: FAIL");
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const admin = createClient(baseUrl);
const databases = [makeDatabaseName("clean"), makeDatabaseName("legacy")];

try {
  await admin.$connect();
  await runCleanScenario(admin, databases[0]);
  await runLegacyScenario(admin, databases[1]);
  console.log("Migration compatibility: PASS");
} catch (error) {
  console.error("Migration compatibility: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  for (const databaseName of databases.reverse()) {
    try {
      await dropDatabase(admin, databaseName);
    } catch (error) {
      console.error(`Could not drop isolated database ${databaseName}:`, error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }

  await admin.$disconnect();
}
