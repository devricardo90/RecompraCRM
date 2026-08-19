-- TASK-09 review recovery: centralize the strict forecast formula, keep
-- normal writes fail-closed, and give the one-time legacy backfill an
-- explicit compatibility policy.
--
-- Historical SaleItems may contain Product.consumptionDays values that were
-- valid before TASK-09 but yield a timestamp outside Prisma/JavaScript's
-- usable DateTime range. Such legacy data must not make migrate deploy
-- impossible. New writes and later mutations remain strict.
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
    -- Two different overflows are reachable from values the API already
    -- accepts: the interval cast itself fails once quantity x
    -- consumptionDays exceeds what an interval can hold
    -- (interval_field_overflow, 22015), and the addition fails when the
    -- result leaves the timestamp range (datetime_field_overflow, 22008).
    -- Both mean the same thing here - no representable forecast - so both
    -- become NULL and are reported by the single raise below.
    v_result := "sold_at" + (v_total_days::text || ' days')::interval;
  EXCEPTION
    WHEN datetime_field_overflow OR interval_field_overflow THEN
      v_result := NULL;
  END;

  -- PostgreSQL's TIMESTAMP ceiling is wider than JavaScript Date's. Prisma
  -- exposes DateTime as a JS Date, so persisted forecasts must fit the
  -- tighter application range as well.
  IF v_result IS NULL OR v_result > TIMESTAMP '275760-09-13' THEN
    RAISE EXCEPTION
      'Cannot compute a repurchase forecast this far out (soldAt=%, quantity=%, consumptionDays=%)',
      "sold_at", "quantity", "consumption_days"
      USING ERRCODE = '22003';
  END IF;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Legacy/backfill-only compatibility wrapper. It deliberately converts only
-- the strict helper's domain overflow (22003) into NULL. Any other database
-- error still aborts the migration. Runtime triggers never call this helper.
CREATE FUNCTION "compute_legacy_expected_repurchase_at"(
  "sold_at" TIMESTAMP(3),
  "quantity" INTEGER,
  "consumption_days" INTEGER
) RETURNS TIMESTAMP(3) AS $$
BEGIN
  RETURN "compute_expected_repurchase_at"("sold_at", "quantity", "consumption_days");
EXCEPTION
  WHEN SQLSTATE '22003' THEN
    RETURN NULL;
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

-- Backfill representable historical forecasts. Rows whose pre-TASK-09 data
-- cannot be represented by Prisma/JavaScript remain NULL instead of blocking
-- deployment; future writes/updates still go through the strict helper.
UPDATE "SaleItem" si
SET "expectedRepurchaseAt" = "compute_legacy_expected_repurchase_at"(s."soldAt", si."quantity", p."consumptionDays")
FROM "Sale" s, "Product" p
WHERE si."saleId" = s."id" AND si."productId" = p."id";
