-- Codex found two more gaps after the previous fix migration:
--
-- P2: the day-count bound (+/-100,000,000 days) only protects against a
--     large day count in isolation. If sold_at is itself already near
--     PostgreSQL's representable TIMESTAMP boundary, adding even a
--     "safely bounded" day count can still overflow - the bound checked
--     the wrong thing. Replace it with catching the actual overflow the
--     addition itself would raise (SQLSTATE 22008,
--     datetime_field_overflow), which is exact for both directions
--     instead of an approximation.
--
-- P2: Product.consumptionDays can be changed through the existing
--     PUT /api/products/:id route, but nothing recomputed the forecasts of
--     SaleItems already referencing that product - only Sale.soldAt
--     propagation was added, not Product.consumptionDays.
CREATE OR REPLACE FUNCTION "compute_expected_repurchase_at"(
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
      RAISE EXCEPTION
        'Cannot compute a repurchase forecast this far out (soldAt=%, quantity=%, consumptionDays=%)',
        "sold_at", "quantity", "consumption_days"
        USING ERRCODE = '22003';
  END;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE FUNCTION "recompute_sale_items_expected_repurchase_for_product"() RETURNS TRIGGER AS $$
BEGIN
  UPDATE "SaleItem" si
  SET "expectedRepurchaseAt" = "compute_expected_repurchase_at"(s."soldAt", si."quantity", NEW."consumptionDays")
  FROM "Sale" s
  WHERE si."productId" = NEW."id" AND si."saleId" = s."id";

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Product_recomputes_item_forecasts_on_consumption_days_update"
AFTER UPDATE OF "consumptionDays" ON "Product"
FOR EACH ROW EXECUTE FUNCTION "recompute_sale_items_expected_repurchase_for_product"();
