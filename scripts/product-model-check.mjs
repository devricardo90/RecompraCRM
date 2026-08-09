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

async function assertRejected(operation, label) {
  let error;

  try {
    const created = await operation();

    if (created?.id) {
      createdIds.push(created.id);
    }
  } catch (caught) {
    error = caught;
  }

  assert(error, `${label} was accepted`);
}

loadLocalEnvironment();

if (!process.env.DATABASE_URL) {
  console.error("Product persistence tests: FAIL");
  console.error("DATABASE_URL is not set. Copy .env.example to .env or export DATABASE_URL.");
  process.exit(1);
}

const prisma = new PrismaClient();
const createdIds = [];
const suffix = `${Date.now()}-${process.pid}`;

try {
  const product = await prisma.product.create({
    data: {
      name: `TASK-05 Product ${suffix}`,
      unit: "un",
      currentStock: 10,
      minimumStock: 2,
      consumptionDays: 30,
    },
  });
  createdIds.push(product.id);

  assert(product.name.startsWith("TASK-05 Product "), "valid product name was not persisted");
  assert(product.unit === "un", "product unit was not persisted");
  assert(product.currentStock === 10, "current stock was not persisted");
  assert(product.minimumStock === 2, "minimum stock was not persisted");
  assert(product.consumptionDays === 30, "consumption duration was not persisted");
  assert(product.createdAt instanceof Date, "createdAt was not returned as a Date");
  assert(product.updatedAt instanceof Date, "updatedAt was not returned as a Date");

  const persisted = await prisma.product.findUnique({ where: { id: product.id } });
  assert(persisted?.id === product.id, "created product was not persisted");

  const updated = await prisma.product.update({
    where: { id: product.id },
    data: { currentStock: 8, minimumStock: 3, consumptionDays: 45 },
  });
  assert(updated.currentStock === 8, "product current stock was not updated");
  assert(updated.minimumStock === 3, "product minimum stock was not updated");
  assert(updated.consumptionDays === 45, "product duration was not updated");
  assert(updated.updatedAt.getTime() >= updated.createdAt.getTime(), "product timestamps are not ordered");

  const [constraintRows] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS "count"
    FROM pg_constraint
    WHERE conrelid = '"Product"'::regclass
      AND conname IN (
        'Product_name_not_blank',
        'Product_unit_not_blank',
        'Product_current_stock_non_negative',
        'Product_minimum_stock_non_negative',
        'Product_consumption_days_positive'
      )
  `;
  assert(constraintRows?.count === 5, "Product constraints were not created");

  await assertRejected(
    () => prisma.product.create({ data: { unit: "un", currentStock: 0, minimumStock: 0, consumptionDays: 1 } }),
    "omitted product name",
  );
  await assertRejected(
    () => prisma.product.create({ data: { name: "", unit: "un", currentStock: 0, minimumStock: 0, consumptionDays: 1 } }),
    "empty product name",
  );
  await assertRejected(
    () => prisma.product.create({ data: { name: "Valid", unit: "   ", currentStock: 0, minimumStock: 0, consumptionDays: 1 } }),
    "blank product unit",
  );
  await assertRejected(
    () => prisma.product.create({ data: { name: "Valid", unit: "un", currentStock: -1, minimumStock: 0, consumptionDays: 1 } }),
    "negative current stock",
  );
  await assertRejected(
    () => prisma.product.create({ data: { name: "Valid", unit: "un", currentStock: 0, minimumStock: -1, consumptionDays: 1 } }),
    "negative minimum stock",
  );
  await assertRejected(
    () => prisma.product.create({ data: { name: "Valid", unit: "un", currentStock: 0, minimumStock: 0, consumptionDays: 0 } }),
    "zero consumption duration",
  );

  await assertRejected(
    () => prisma.product.update({ where: { id: product.id }, data: { currentStock: -1 } }),
    "negative current stock update",
  );

  await prisma.product.delete({ where: { id: product.id } });
  const deleted = await prisma.product.findUnique({ where: { id: product.id } });
  assert(deleted === null, "product was not deleted");
  createdIds.splice(createdIds.indexOf(product.id), 1);

  console.log("Product persistence tests: PASS");
} catch (error) {
  console.error("Product persistence tests: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (createdIds.length > 0) {
    await prisma.product.deleteMany({ where: { id: { in: createdIds } } });
  }
  await prisma.$disconnect();
}
