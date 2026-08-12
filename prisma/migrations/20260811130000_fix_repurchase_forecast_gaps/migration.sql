-- Codex found three gaps in the previous migration's repurchase-forecast
-- trigger:
--
-- P1: it only affects future INSERT/UPDATE on SaleItem, so rows created
--     under TASK-07/08 (before this feature existed) keep NULL forever.
-- P2: it listens only to SaleItem changes, so correcting a persisted
--     Sale.soldAt never propagates to that sale's item forecasts.
-- P2: quantity/consumptionDays are currently unbounded (up to PostgreSQL's
--     INTEGER max), and "quantity x consumptionDays" days can exceed both
--     INTEGER range and PostgreSQL's representable TIMESTAMP range, which
--     would abort an otherwise valid sale with a low-level arithmetic error.
--
-- Factor the formula into a shared, guarded function so both the
-- SaleItem-level trigger and the new Sale.soldAt-level trigger compute it
-- identically, then use it to backfill existing rows.
-- The backfill at the end of this migration calls this function against
-- every existing row, so it must already be exact - an intermediate,
-- overly-strict version here would abort this migration's own backfill on
-- legitimate historical data before a later migration could ever replace
-- it, blocking deploy entirely.
CREATE FUNCTION "compute_expected_repurchase_at"(
  "sold_at" TIMESTAMP(3),
  "quantity" INTEGER,
  "consumption_days" INTEGER
) RETURNS TIMESTAMP(3) AS $$
DECLARE
  v_total_days BIGINT;
  v_result TIMESTAMP(3);
BEGIN
  IF "sold_at" IS NULL OR "consumption_days" IS NULL THEN
    RETURN NULL;
  END IF;

  -- bigint avoids INTEGER overflow in the multiplication itself.
  v_total_days := "quantity"::BIGINT * "consumption_days";

  BEGIN
    v_result := "sold_at" + (v_total_days::text || ' days')::interval;
  EXCEPTION
    WHEN datetime_field_overflow THEN
      v_result := NULL;
  END;

  -- PostgreSQL's own TIMESTAMP range (~4713 BC to ~294276 AD) is wider than
  -- what a JavaScript Date can represent (~271821 BC to 275760 AD), and
  -- Prisma exposes this column as a JS Date that the application calls
  -- methods like getTime() on. Bound to the tighter of the two ranges so a
  -- forecast PostgreSQL accepts can't still be undecodable by the app.
  -- PostgreSQL's floor is already stricter than JS's floor, so the
  -- exception above covers that side; only the ceiling needs an explicit
  -- check here.
  IF v_result IS NULL OR v_result > TIMESTAMP '275760-09-13' THEN
    RAISE EXCEPTION
      'Cannot compute a repurchase forecast this far out (soldAt=%, quantity=%, consumptionDays=%)',
      "sold_at", "quantity", "consumption_days"
      USING ERRCODE = '22003';
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION "compute_sale_item_expected_repurchase"() RETURNS TRIGGER AS $$
DECLARE
  v_sold_at TIMESTAMP(3);
  v_consumption_days INTEGER;
BEGIN
  SELECT "soldAt" INTO v_sold_at FROM "Sale" WHERE "id" = NEW."saleId";
  SELECT "consumptionDays" INTO v_consumption_days FROM "Product" WHERE "id" = NEW."productId";

  NEW."expectedRepurchaseAt" := "compute_expected_repurchase_at"(v_sold_at, NEW."quantity", v_consumption_days);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "recompute_sale_items_expected_repurchase"() RETURNS TRIGGER AS $$
BEGIN
  UPDATE "SaleItem" si
  SET "expectedRepurchaseAt" = "compute_expected_repurchase_at"(NEW."soldAt", si."quantity", p."consumptionDays")
  FROM "Product" p
  WHERE si."saleId" = NEW."id" AND si."productId" = p."id";

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Sale_recomputes_item_forecasts_on_soldAt_update"
AFTER UPDATE OF "soldAt" ON "Sale"
FOR EACH ROW EXECUTE FUNCTION "recompute_sale_items_expected_repurchase"();

UPDATE "SaleItem" si
SET "expectedRepurchaseAt" = "compute_expected_repurchase_at"(s."soldAt", si."quantity", p."consumptionDays")
FROM "Sale" s, "Product" p
WHERE si."saleId" = s."id" AND si."productId" = p."id";
