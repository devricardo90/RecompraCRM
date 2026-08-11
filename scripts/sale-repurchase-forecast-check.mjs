import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const repoRoot = process.cwd();
const schemaPath = resolve(repoRoot, "prisma", "schema.prisma");
const migrationCli = resolve(repoRoot, "node_modules", "prisma", "build", "index.js");
const DAY_MS = 24 * 60 * 60 * 1000;

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
  console.error("Sale repurchase forecast tests: FAIL");
  console.error("DATABASE_URL is not set. Copy .env.example to .env or export DATABASE_URL.");
  process.exit(1);
}

const suffix = `${Date.now()}-${process.pid}`;
const schemaName = `sale_repurchase_check_${Date.now()}_${process.pid}`;
const isolatedUrl = new URL(process.env.DATABASE_URL);
isolatedUrl.searchParams.set("schema", schemaName);
const admin = new PrismaClient();
const prisma = new PrismaClient({ datasources: { db: { url: isolatedUrl.toString() } } });
let customerId;

async function makeProduct(consumptionDays, stock = 100) {
  const product = await prisma.product.create({
    data: {
      name: `TASK-09 Product ${suffix}-${consumptionDays}-${Math.random().toString(36).slice(2, 7)}`,
      unit: "un",
      currentStock: stock,
      minimumStock: 1,
      consumptionDays,
    },
  });
  return product.id;
}

try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA ${quoteSchemaName(schemaName)}`);
  runMigrations(isolatedUrl.toString());

  const customer = await prisma.customer.create({ data: { name: `TASK-09 Customer ${suffix}` } });
  customerId = customer.id;
  const soldAt = new Date("2026-08-11T09:00:00.000Z");

  // Case A: single item - soldAt + quantity * consumptionDays days.
  {
    const productId = await makeProduct(30);
    const sale = await prisma.sale.create({
      data: {
        customerId,
        soldAt,
        status: "MODEL_TEST",
        items: { create: [{ productId, quantity: 3 }] },
      },
      include: { items: true },
    });
    const expected = new Date(soldAt.getTime() + 3 * 30 * DAY_MS);
    assert(
      sale.items[0].expectedRepurchaseAt.getTime() === expected.getTime(),
      "single-item forecast did not match soldAt + quantity * consumptionDays",
    );
  }

  // Case B: multiple items on the same Sale get independent forecasts per
  // item, using each item's own product and quantity ("Vendas com vários
  // produtos geram previsões por item").
  {
    const productAId = await makeProduct(30);
    const productBId = await makeProduct(10);
    const sale = await prisma.sale.create({
      data: {
        customerId,
        soldAt,
        status: "MODEL_TEST",
        items: {
          create: [
            { productId: productAId, quantity: 2 },
            { productId: productBId, quantity: 5 },
          ],
        },
      },
      include: { items: true },
    });
    const itemA = sale.items.find((item) => item.productId === productAId);
    const itemB = sale.items.find((item) => item.productId === productBId);
    assert(
      itemA.expectedRepurchaseAt.getTime() === soldAt.getTime() + 2 * 30 * DAY_MS,
      "item A forecast did not use its own product's consumptionDays",
    );
    assert(
      itemB.expectedRepurchaseAt.getTime() === soldAt.getTime() + 5 * 10 * DAY_MS,
      "item B forecast did not use its own product's consumptionDays",
    );
    assert(
      itemA.expectedRepurchaseAt.getTime() !== itemB.expectedRepurchaseAt.getTime(),
      "distinct items must not collapse to the same forecast",
    );
  }

  // Case C: a different Sale's soldAt changes the forecast base date.
  {
    const productId = await makeProduct(7);
    const laterSoldAt = new Date("2026-09-01T00:00:00.000Z");
    const sale = await prisma.sale.create({
      data: {
        customerId,
        soldAt: laterSoldAt,
        status: "MODEL_TEST",
        items: { create: [{ productId, quantity: 1 }] },
      },
      include: { items: true },
    });
    assert(
      sale.items[0].expectedRepurchaseAt.getTime() === laterSoldAt.getTime() + 7 * DAY_MS,
      "forecast did not anchor to its own Sale's soldAt",
    );
  }

  // Case D: increasing quantity recomputes the forecast further out.
  {
    const productId = await makeProduct(4);
    const sale = await prisma.sale.create({
      data: {
        customerId,
        soldAt,
        status: "MODEL_TEST",
        items: { create: [{ productId, quantity: 2 }] },
      },
      include: { items: true },
    });
    const itemId = sale.items[0].id;

    const updated = await prisma.saleItem.update({ where: { id: itemId }, data: { quantity: 6 } });
    assert(
      updated.expectedRepurchaseAt.getTime() === soldAt.getTime() + 6 * 4 * DAY_MS,
      "quantity update did not recompute the forecast",
    );
  }

  // Case E: reassigning to a different product recomputes using the new
  // product's consumptionDays - the same mutation TASK-08 already handles
  // for stock.
  {
    const oldProductId = await makeProduct(30);
    const newProductId = await makeProduct(3);
    const sale = await prisma.sale.create({
      data: {
        customerId,
        soldAt,
        status: "MODEL_TEST",
        items: { create: [{ productId: oldProductId, quantity: 4 }] },
      },
      include: { items: true },
    });
    const itemId = sale.items[0].id;

    const reassigned = await prisma.saleItem.update({ where: { id: itemId }, data: { productId: newProductId } });
    assert(
      reassigned.expectedRepurchaseAt.getTime() === soldAt.getTime() + 4 * 3 * DAY_MS,
      "productId reassignment did not recompute the forecast using the new product",
    );
  }

  // Case F: rows written while the SaleItem trigger is absent (simulating
  // pre-TASK-09 data) are backfilled by the same computation the migration
  // runs once, not left NULL forever.
  {
    const productId = await makeProduct(12);
    await prisma.$executeRaw`DROP TRIGGER "SaleItem_computes_expected_repurchase" ON "SaleItem"`;
    const sale = await prisma.sale.create({
      data: {
        customerId,
        soldAt,
        status: "MODEL_TEST",
        items: { create: [{ productId, quantity: 5 }] },
      },
      include: { items: true },
    });
    const itemId = sale.items[0].id;
    const beforeBackfill = await prisma.saleItem.findUniqueOrThrow({ where: { id: itemId } });
    assert(beforeBackfill.expectedRepurchaseAt === null, "test setup must produce a NULL forecast without the trigger");

    await prisma.$executeRaw`
      UPDATE "SaleItem" si
      SET "expectedRepurchaseAt" = "compute_expected_repurchase_at"(s."soldAt", si."quantity", p."consumptionDays")
      FROM "Sale" s, "Product" p
      WHERE si."saleId" = s."id" AND si."productId" = p."id" AND si."id" = ${itemId}
    `;
    const afterBackfill = await prisma.saleItem.findUniqueOrThrow({ where: { id: itemId } });
    assert(
      afterBackfill.expectedRepurchaseAt?.getTime() === soldAt.getTime() + 5 * 12 * DAY_MS,
      "backfill did not compute the same formula as the trigger",
    );

    await prisma.$executeRaw`
      CREATE TRIGGER "SaleItem_computes_expected_repurchase"
      BEFORE INSERT OR UPDATE OF "quantity", "productId", "saleId" ON "SaleItem"
      FOR EACH ROW EXECUTE FUNCTION "compute_sale_item_expected_repurchase"()
    `;
  }

  // Case G: correcting a Sale's soldAt propagates to every one of its
  // items' forecasts, not just future SaleItem mutations.
  {
    const productAId = await makeProduct(20);
    const productBId = await makeProduct(6);
    const sale = await prisma.sale.create({
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
      include: { items: true },
    });
    const correctedSoldAt = new Date("2026-08-05T00:00:00.000Z");
    await prisma.sale.update({ where: { id: sale.id }, data: { soldAt: correctedSoldAt } });

    const items = await prisma.saleItem.findMany({ where: { saleId: sale.id } });
    const itemA = items.find((item) => item.productId === productAId);
    const itemB = items.find((item) => item.productId === productBId);
    assert(
      itemA.expectedRepurchaseAt.getTime() === correctedSoldAt.getTime() + 3 * 20 * DAY_MS,
      "correcting Sale.soldAt did not recompute item A's forecast",
    );
    assert(
      itemB.expectedRepurchaseAt.getTime() === correctedSoldAt.getTime() + 2 * 6 * DAY_MS,
      "correcting Sale.soldAt did not recompute item B's forecast",
    );
  }

  // Case H: a quantity/consumptionDays combination that would produce a
  // non-representable forecast is rejected with a clear error instead of
  // a low-level arithmetic or timestamp-range failure, and changes nothing.
  {
    const productId = await makeProduct(2147483647);
    const salesBefore = await prisma.sale.count();
    let error;
    try {
      await prisma.sale.create({
        data: {
          customerId,
          soldAt,
          status: "MODEL_TEST",
          items: { create: [{ productId, quantity: 1 }] },
        },
      });
    } catch (caught) {
      error = caught;
    }
    assert(error, "an overflowing quantity x consumptionDays combination was accepted");
    const salesAfter = await prisma.sale.count();
    assert(salesAfter === salesBefore, "rejected overflow still persisted a Sale");
  }

  console.log("Sale repurchase forecast tests: PASS");
} catch (error) {
  console.error("Sale repurchase forecast tests: FAIL");
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
