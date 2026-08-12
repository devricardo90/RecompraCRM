-- Codex found that Product.consumptionDays can be changed through the
-- existing PUT /api/products/:id route, but nothing recomputed the
-- forecasts of SaleItems already referencing that product - only
-- Sale.soldAt propagation was added, not Product.consumptionDays.
--
-- (compute_expected_repurchase_at's overflow handling was corrected
-- directly in 20260811130000_fix_repurchase_forecast_gaps rather than
-- layered here - that migration's own backfill calls it, so an
-- intermediate, overly-strict version there would have aborted deploy on
-- legitimate historical data before this migration could ever run.)
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
