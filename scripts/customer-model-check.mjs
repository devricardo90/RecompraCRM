import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

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

function hasErrorCode(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function assertCreateRejected(data, label) {
  let created;
  let error;

  try {
    created = await prisma.customer.create({ data });
  } catch (caught) {
    error = caught;
  }

  if (created) {
    createdIds.push(created.id);
  }

  assert(!created && error, `${label} was accepted`);
}

loadLocalEnvironment();

if (!process.env.DATABASE_URL) {
  console.error("Customer persistence tests: FAIL");
  console.error("DATABASE_URL is not set. Copy .env.example to .env or export DATABASE_URL.");
  process.exit(1);
}

const prisma = new PrismaClient();
const createdIds = [];
const suffix = `${Date.now()}-${process.pid}`;

try {
  const phone = `+551199${String(Date.now()).slice(-8)}`;
  const customer = await prisma.customer.create({
    data: {
      name: `TASK-03 Customer ${suffix}`,
      phone,
    },
  });
  createdIds.push(customer.id);

  assert(customer.name.startsWith("TASK-03 Customer "), "valid customer name was not persisted");
  assert(customer.phone === phone, "valid customer phone was not persisted");
  assert(customer.createdAt instanceof Date, "createdAt was not returned as a Date");
  assert(customer.updatedAt instanceof Date, "updatedAt was not returned as a Date");
  assert(customer.updatedAt.getTime() >= customer.createdAt.getTime(), "timestamps are not ordered");

  const persisted = await prisma.customer.findUnique({ where: { id: customer.id } });
  assert(persisted?.id === customer.id, "created customer was not persisted");

  const [nameConstraint] = await prisma.$queryRaw`
    SELECT convalidated AS "validated"
    FROM pg_constraint
    WHERE conrelid = '"Customer"'::regclass
      AND conname = 'Customer_name_not_blank'
  `;
  assert(nameConstraint?.validated === true, "customer name constraint was not validated on a clean database");

  await assertCreateRejected({ phone: null }, "omitted customer name");
  await assertCreateRejected({ name: "" }, "empty customer name");
  await assertCreateRejected({ name: "   " }, "space-only customer name");
  await assertCreateRejected({ name: "\t\t" }, "tab-only customer name");
  await assertCreateRejected({ name: "\n\r\t" }, "line-break-only customer name");

  let duplicatePhoneRejected = false;
  try {
    const duplicate = await prisma.customer.create({
      data: { name: `TASK-03 Duplicate ${suffix}`, phone },
    });
    createdIds.push(duplicate.id);
  } catch (error) {
    duplicatePhoneRejected = hasErrorCode(error, "P2002");
  }
  assert(duplicatePhoneRejected, "duplicate informed phone was not rejected by the unique constraint");

  const withoutPhoneA = await prisma.customer.create({
    data: { name: `TASK-03 No Phone A ${suffix}` },
  });
  createdIds.push(withoutPhoneA.id);

  const withoutPhoneB = await prisma.customer.create({
    data: { name: `TASK-03 No Phone B ${suffix}`, phone: null },
  });
  createdIds.push(withoutPhoneB.id);

  assert(withoutPhoneA.phone === null && withoutPhoneB.phone === null, "optional phone was not persisted as null");

  console.log("Customer persistence tests: PASS");
} catch (error) {
  console.error("Customer persistence tests: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (createdIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: createdIds } } });
  }
  await prisma.$disconnect();
}
