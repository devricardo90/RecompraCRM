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
CREATE FUNCTION "compute_expected_repurchase_at"(
  "sold_at" TIMESTAMP(3),
  "quantity" INTEGER,
  "consumption_days" INTEGER
) RETURNS TIMESTAMP(3) AS $$
DECLARE
  v_total_days BIGINT;
BEGIN
  IF "sold_at" IS NULL OR "consumption_days" IS NULL THEN
    RETURN NULL;
  END IF;

  -- Cast to bigint before multiplying so this can't overflow INTEGER, then
  -- reject anything that would still overflow PostgreSQL's representable
  -- TIMESTAMP range (roughly +/-292,000 years) with a clear error instead
  -- of a low-level arithmetic/timestamp-range one.
  v_total_days := "quantity"::BIGINT * "consumption_days";

  IF v_total_days > 100000000 OR v_total_days < -100000000 THEN
    RAISE EXCEPTION
      'Cannot compute a repurchase forecast this far out (quantity % x consumptionDays % = % days)',
      "quantity", "consumption_days", v_total_days
      USING ERRCODE = '22003';
  END IF;

  RETURN "sold_at" + (v_total_days::text || ' days')::interval;
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
