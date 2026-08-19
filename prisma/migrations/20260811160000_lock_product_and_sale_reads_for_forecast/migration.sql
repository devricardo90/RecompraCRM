-- TASK-09 review recovery: serialize forecast input reads with the writes
-- that can race them, without creating a shared-lock upgrade deadlock.
--
-- Sale.soldAt only needs to conflict with a concurrent Sale UPDATE, so a
-- shared row lock is sufficient there. Product is different: the same
-- SaleItem INSERT later reduces Product.currentStock in TASK-08. If two
-- inserts first take compatible FOR SHARE locks and then both try to UPDATE
-- Product, PostgreSQL can deadlock while each transaction upgrades its lock.
-- Acquiring FOR NO KEY UPDATE on Product from the start makes concurrent
-- sales serialize before the stock UPDATE while also conflicting with a
-- concurrent consumptionDays UPDATE.
CREATE OR REPLACE FUNCTION "compute_sale_item_expected_repurchase"() RETURNS TRIGGER AS $$
DECLARE
  v_sold_at TIMESTAMP(3);
  v_consumption_days INTEGER;
BEGIN
  SELECT "soldAt"
  INTO v_sold_at
  FROM "Sale"
  WHERE "id" = NEW."saleId"
  FOR SHARE;

  SELECT "consumptionDays"
  INTO v_consumption_days
  FROM "Product"
  WHERE "id" = NEW."productId"
  FOR NO KEY UPDATE;

  NEW."expectedRepurchaseAt" := "compute_expected_repurchase_at"(v_sold_at, NEW."quantity", v_consumption_days);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
