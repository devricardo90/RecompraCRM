-- TASK-09: previsão inicial de recompra por item = data da venda + quantidade
-- vendida x dias de consumo por unidade do produto (docs/product/PROJECT-SDD.md).
--
-- A BEFORE trigger (not AFTER) is required so it can set NEW.expectedRepurchaseAt
-- before the row is physically written. It fires on INSERT and on UPDATE of
-- quantity/productId/saleId - the same mutations TASK-08 already had to
-- reconcile stock for - so a legal item edit that changes the formula's
-- inputs keeps the forecast in sync instead of leaving it stale.
--
-- FK constraints on productId/saleId are checked after BEFORE ROW triggers
-- run, so a nonexistent product/sale here just leaves the forecast NULL;
-- the existing FK check still rejects the whole transaction afterward, same
-- as any other invalid reference.
CREATE FUNCTION "compute_sale_item_expected_repurchase"() RETURNS TRIGGER AS $$
DECLARE
  v_sold_at TIMESTAMP(3);
  v_consumption_days INTEGER;
BEGIN
  SELECT "soldAt" INTO v_sold_at FROM "Sale" WHERE "id" = NEW."saleId";
  SELECT "consumptionDays" INTO v_consumption_days FROM "Product" WHERE "id" = NEW."productId";

  NEW."expectedRepurchaseAt" := v_sold_at + (NEW."quantity" * v_consumption_days) * INTERVAL '1 day';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SaleItem_computes_expected_repurchase"
BEFORE INSERT OR UPDATE OF "quantity", "productId", "saleId" ON "SaleItem"
FOR EACH ROW EXECUTE FUNCTION "compute_sale_item_expected_repurchase"();
