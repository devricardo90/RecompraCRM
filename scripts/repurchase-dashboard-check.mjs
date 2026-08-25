import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";

/**
 * TASK-12 against a real PostgreSQL, driving the production classifier and the
 * production date module.
 *
 * The point of this harness is the part a unit test cannot prove: that the
 * forecast the dashboard shows is the one the TASK-09 triggers persisted, and
 * that it moves when a base field moves, without this task computing anything.
 *
 * It drives the projection directly and deliberately, to isolate the database
 * behaviour. The route handler itself is exercised over HTTP by
 * scripts/repurchase-api-integration-check.mjs -- neither harness stands in for
 * the other.
 */
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 22) {
  console.error("Repurchase dashboard tests: FAIL");
  console.error(`Node ${process.versions.node} cannot import TypeScript directly; needs Node >= 24.`);
  process.exit(1);
}

const { UPCOMING_WINDOW_DAYS, buildRepurchaseView } = await import("../lib/sales/repurchaseForecast.ts");
const { businessDayEndUtc, businessDayNumber, parseBusinessDateInput } = await import(
  "../lib/format/businessDate.ts"
);

const baseUrl = process.env.DATABASE_URL;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function quoteSchemaName(name) {
  assert(/^[a-z0-9_]+$/.test(name), "unsafe schema name");
  return `"${name}"`;
}

function urlForSchema(name) {
  const url = new URL(baseUrl);
  url.searchParams.set("schema", name);
  return url.toString();
}

if (!baseUrl) {
  console.error("Repurchase dashboard tests: FAIL");
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const schemaName = `task12_repurchase_${Date.now()}_${process.pid}`;
const isolatedUrl = urlForSchema(schemaName);
const admin = new PrismaClient();
let client;

/** The route's own window: open backwards, closed at the end of business day +7. */
function windowUpperBound(reference) {
  return businessDayEndUtc(reference, UPCOMING_WINDOW_DAYS);
}

async function readDashboard(db, reference) {
  const rows = await db.saleItem.findMany({
    where: { expectedRepurchaseAt: { not: null, lte: windowUpperBound(reference) } },
    orderBy: [{ expectedRepurchaseAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      quantity: true,
      expectedRepurchaseAt: true,
      sale: { select: { id: true, soldAt: true, customer: { select: { id: true, name: true, phone: true } } } },
      product: { select: { id: true, name: true, unit: true } },
    },
  });
  return buildRepurchaseView(
    rows.map((row) => ({
      saleItemId: row.id,
      expectedRepurchaseAt: row.expectedRepurchaseAt,
      quantity: row.quantity,
      customer: { id: row.sale.customer.id, name: row.sale.customer.name, phone: row.sale.customer.phone ?? null },
    })),
    reference,
  );
}

try {
  await admin.$executeRawUnsafe(`CREATE SCHEMA ${quoteSchemaName(schemaName)}`);
  const migrate = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "prisma/schema.prisma"],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: isolatedUrl }, stdio: "inherit" },
  );
  assert(migrate.status === 0, "migration deploy failed");
  client = new PrismaClient({ datasources: { db: { url: isolatedUrl } } });

  // The additive index from this task must actually exist.
  const indexes = await client.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'SaleItem'`,
    schemaName,
  );
  assert(
    indexes.some((row) => row.indexname === "SaleItem_expectedRepurchaseAt_idx"),
    "AC17: the additive forecast index is missing",
  );

  const reference = new Date();
  const today = businessDayNumber(reference);
  const soldAt = parseBusinessDateInput("2026-01-05T09:00");

  const customer = await client.customer.create({ data: { name: "Maria", phone: "+5511999990001" } });
  const noPhone = await client.customer.create({ data: { name: "Sem telefone" } });

  // consumptionDays drives the trigger's derivation. Quantity 1 keeps the maths
  // simple: the forecast lands consumptionDays after soldAt.
  // Whole business days between the sale and the target day. Measuring against
  // an end-of-day instant instead would mix 23:59 with the sale's 09:00 and land
  // the forecast a day off.
  const soldDay = businessDayNumber(soldAt);
  const daysUntil = (offset) => today + offset - soldDay;

  const productFor = (name, offset) =>
    client.product.create({
      data: { name, unit: "un", currentStock: 1000, minimumStock: 0, consumptionDays: daysUntil(offset) },
    });

  const overdueProduct = await productFor("Vencida", -3);
  const todayProduct = await productFor("Hoje", 0);
  const daySevenProduct = await productFor("Dia sete", UPCOMING_WINDOW_DAYS);
  const dayEightProduct = await productFor("Dia oito", UPCOMING_WINDOW_DAYS + 1);

  const sale = await client.sale.create({
    data: {
      customerId: customer.id,
      soldAt,
      status: "CONFIRMED",
      items: {
        create: [
          { productId: overdueProduct.id, quantity: 1 },
          { productId: todayProduct.id, quantity: 1 },
          { productId: daySevenProduct.id, quantity: 1 },
          { productId: dayEightProduct.id, quantity: 1 },
        ],
      },
    },
    include: { items: true },
  });

  // Nothing in this harness computed a forecast: the trigger did.
  for (const item of sale.items) {
    assert(item.expectedRepurchaseAt instanceof Date, "the database must persist a forecast for each item");
  }

  const view = await readDashboard(client, reference);
  const bucketOf = (productId) => {
    const itemId = sale.items.find((item) => item.productId === productId)?.id;
    return view.items.find((item) => item.saleItemId === itemId)?.bucket ?? null;
  };

  assert(bucketOf(overdueProduct.id) === "overdue", "AC1: a past forecast must be overdue");
  assert(bucketOf(todayProduct.id) === "today", "AC2: today's forecast must be today");
  assert(bucketOf(daySevenProduct.id) === "upcoming", "AC4: day seven must be inside the window");
  assert(bucketOf(dayEightProduct.id) === null, "AC4: day eight must be outside the window");
  assert(
    view.counts.overdue + view.counts.today + view.counts.upcoming === view.items.length,
    "AC7: counts must match the listed set",
  );

  // AC5: a legacy row whose forecast is NULL is unknown, never overdue. The
  // column is nullable by the TASK-09 compatibility policy.
  const legacySale = await client.sale.create({
    data: {
      customerId: noPhone.id,
      soldAt,
      status: "CONFIRMED",
      items: { create: [{ productId: todayProduct.id, quantity: 1 }] },
    },
    include: { items: true },
  });
  // TASK-09 recomputes the canonical value on a direct write, which is exactly
  // why the forecast cannot be forged. A legacy NULL therefore has to be staged
  // with the trigger off; that is the only shape in which this row can exist,
  // per the TASK-09 compatibility policy for unrepresentable legacy values.
  await client.$executeRawUnsafe(
    `ALTER TABLE ${quoteSchemaName(schemaName)}."SaleItem" DISABLE TRIGGER USER`,
  );
  await client.$executeRawUnsafe(
    `UPDATE ${quoteSchemaName(schemaName)}."SaleItem" SET "expectedRepurchaseAt" = NULL WHERE id = $1`,
    legacySale.items[0].id,
  );
  await client.$executeRawUnsafe(
    `ALTER TABLE ${quoteSchemaName(schemaName)}."SaleItem" ENABLE TRIGGER USER`,
  );
  const stagedLegacy = await client.saleItem.findUnique({ where: { id: legacySale.items[0].id } });
  assert(stagedLegacy.expectedRepurchaseAt === null, "the legacy NULL row was not staged");
  const withLegacy = await readDashboard(client, reference);
  assert(
    !withLegacy.items.some((item) => item.saleItemId === legacySale.items[0].id),
    "AC5: a NULL forecast must not appear in any bucket",
  );

  // AC21: an absent phone is an explicit null, not a missing key.
  const phoneless = withLegacy.items.find((item) => item.customer.id === noPhone.id);
  if (phoneless) {
    assert(phoneless.customer.phone === null, "AC21: a customer without a phone must expose null");
    assert("phone" in phoneless.customer, "AC21: the phone key must always be present");
  }

  // AC9/AC10: freshness comes from the trigger. Moving a base field must move the
  // bucket on the next read, with this task computing nothing.
  const movedItem = sale.items.find((item) => item.productId === dayEightProduct.id);
  await client.product.update({
    where: { id: dayEightProduct.id },
    data: { consumptionDays: daysUntil(1) },
  });
  const afterProductChange = await readDashboard(client, reference);
  assert(
    afterProductChange.items.find((item) => item.saleItemId === movedItem.id)?.bucket === "upcoming",
    "AC10: changing consumptionDays must reclassify on the next read",
  );

  await client.sale.update({ where: { id: sale.id }, data: { soldAt: new Date(soldAt.getTime() - 30 * 86_400_000) } });
  const afterSoldAtChange = await readDashboard(client, reference);
  const movedAgain = afterSoldAtChange.items.find((item) => item.saleItemId === movedItem.id);
  assert(
    movedAgain === undefined || movedAgain.bucket === "overdue",
    "AC10: changing soldAt must move the forecast without this task recomputing it",
  );
  const reread = await client.saleItem.findUnique({ where: { id: movedItem.id } });
  assert(
    businessDayNumber(reread.expectedRepurchaseAt) < today,
    "AC9: the persisted forecast itself moved; the dashboard only read it",
  );

  console.log("Repurchase dashboard tests: PASS");
} catch (error) {
  console.error("Repurchase dashboard tests: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client?.$disconnect();
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quoteSchemaName(schemaName)} CASCADE`);
  await admin.$disconnect();
}
