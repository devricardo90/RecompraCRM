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
    await operation();
  } catch (caught) {
    error = caught;
  }

  assert(error, `${label} was accepted`);
}

loadLocalEnvironment();

if (!process.env.DATABASE_URL) {
  console.error("Sale persistence tests: FAIL");
  console.error("DATABASE_URL is not set. Copy .env.example to .env or export DATABASE_URL.");
  process.exit(1);
}

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${process.pid}`;
let customerId;
let productAId;
let productBId;

try {
  const customer = await prisma.customer.create({
    data: { name: `TASK-07 Customer ${suffix}` },
  });
  customerId = customer.id;

  const [productA, productB] = await Promise.all([
    prisma.product.create({
      data: {
        name: `TASK-07 Product A ${suffix}`,
        unit: "un",
        currentStock: 10,
        minimumStock: 2,
        consumptionDays: 30,
      },
    }),
    prisma.product.create({
      data: {
        name: `TASK-07 Product B ${suffix}`,
        unit: "un",
        currentStock: 8,
        minimumStock: 1,
        consumptionDays: 15,
      },
    }),
  ]);
  productAId = productA.id;
  productBId = productB.id;

  const soldAt = new Date("2026-08-09T12:00:00.000Z");
  const sale = await prisma.sale.create({
    data: {
      customerId,
      soldAt,
      status: "MODEL_TEST",
      notes: "TASK-07 relational persistence",
      items: {
        create: [
          { productId: productAId, quantity: 2 },
          { productId: productBId, quantity: 1, unitPrice: "19.90" },
        ],
      },
    },
    include: { customer: true, items: { include: { product: true } } },
  });
  assert(sale.customer.id === customerId, "Sale customer relation was not persisted");
  assert(sale.soldAt.getTime() === soldAt.getTime(), "Sale soldAt was not persisted");
  assert(sale.items.length === 2, "Sale did not persist both items");
  assert(sale.items.every((item) => item.quantity > 0), "SaleItem quantity was not positive");
  assert(sale.items.some((item) => item.product.id === productAId), "Product A relation was not persisted");
  assert(sale.items.some((item) => item.product.id === productBId), "Product B relation was not persisted");
  assert(sale.items.some((item) => item.unitPrice === null), "optional unitPrice was not persisted as null");
  assert(sale.items.some((item) => item.unitPrice?.toString() === "19.9"), "optional unitPrice value was not persisted");
  assert(sale.items[0].expectedRepurchaseAt === null, "Repurchase calculation was started in TASK-07");
  assert(sale.createdAt instanceof Date && sale.updatedAt instanceof Date, "Sale timestamps were not returned as dates");

  const persisted = await prisma.sale.findUnique({
    where: { id: sale.id },
    include: { items: true },
  });
  assert(persisted?.items.length === 2, "Sale graph was not persisted in PostgreSQL");

  const [quantityConstraint] = await prisma.$queryRaw`
    SELECT convalidated AS "validated"
    FROM pg_constraint
    WHERE conrelid = '"SaleItem"'::regclass
      AND conname = 'SaleItem_quantity_positive'
  `;
  assert(quantityConstraint?.validated === true, "SaleItem quantity constraint is missing or not validated");

  const [triggerCount] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS "count"
    FROM pg_trigger
    WHERE tgrelid IN ('"Sale"'::regclass, '"SaleItem"'::regclass)
      AND tgname IN ('Sale_requires_item', 'SaleItem_preserves_sale_items', 'Sale_deletion_blocked')
      AND NOT tgisinternal
  `;
  assert(triggerCount?.count === 3, "Sale integrity triggers were not created");

  await assertRejected(
    () => prisma.sale.create({ data: { customerId, soldAt, status: "MODEL_TEST" } }),
    "Sale without items",
  );
  await assertRejected(
    () => prisma.sale.create({
      data: {
        customerId,
        soldAt,
        status: "MODEL_TEST",
        items: { create: [{ productId: productAId, quantity: 0 }] },
      },
    }),
    "SaleItem with zero quantity",
  );
  await assertRejected(
    () => prisma.sale.create({
      data: {
        customerId,
        soldAt,
        status: "MODEL_TEST",
        items: { create: [{ productId: productAId, quantity: -1 }] },
      },
    }),
    "SaleItem with negative quantity",
  );
  await assertRejected(
    () => prisma.sale.create({
      data: {
        customerId: 2_147_483_647,
        soldAt,
        status: "MODEL_TEST",
        items: { create: [{ productId: productAId, quantity: 1 }] },
      },
    }),
    "Sale with nonexistent customer",
  );
  await assertRejected(
    () => prisma.sale.create({
      data: {
        customerId,
        soldAt,
        status: "MODEL_TEST",
        items: { create: [{ productId: 2_147_483_647, quantity: 1 }] },
      },
    }),
    "SaleItem with nonexistent product",
  );
  await assertRejected(
    () => prisma.saleItem.deleteMany({ where: { saleId: sale.id } }),
    "removal that leaves a Sale without items",
  );
  await assertRejected(
    () => prisma.customer.delete({ where: { id: customerId } }),
    "Customer deletion while referenced by Sale",
  );
  await assertRejected(
    () => prisma.product.delete({ where: { id: productAId } }),
    "Product deletion while referenced by SaleItem",
  );
  await assertRejected(
    () => prisma.sale.delete({ where: { id: sale.id } }),
    "Sale deletion before a stock-restoration policy exists",
  );
  await assertRejected(
    () => prisma.$transaction(async (transaction) => {
      await transaction.saleItem.deleteMany({ where: { saleId: sale.id } });
      await transaction.sale.delete({ where: { id: sale.id } });
    }),
    "transactional Sale deletion after removing all items",
  );

  console.log("Sale persistence tests: PASS");
} catch (error) {
  console.error("Sale persistence tests: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
