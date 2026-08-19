-- TASK-09 review recovery (round 4): drop the Sale FOR SHARE that the
-- statement-level advisory gate made redundant, and which was itself the last
-- remaining deadlock edge between two ordinary SaleItem writes.
--
-- "SaleItem"."saleId" is mutable, and moving an item between sales is legal
-- whenever the source sale keeps another item (TASK-07 only blocks removing
-- the last one). Two transactions moving items in opposite directions -
-- A -> B and B -> A - both pass the shared advisory gate, as they should:
-- they are both the child direction, and the gate only excludes the parent
-- direction.
--
-- With the previous forecast trigger they then deadlocked anyway:
--
--   each takes FOR SHARE on its *destination* Sale while reading soldAt,
--   and the deferred "SaleItem_preserves_sale_items" guard updates its
--   *source* Sale at COMMIT.
--
-- So the A -> B transaction holds a share lock on B and needs to update A,
-- while the B -> A transaction holds a share lock on A and needs to update B.
-- Each share lock blocks the other's update and PostgreSQL aborts one.
--
-- The share lock is no longer buying anything. It was added so that reading
-- "Sale"."soldAt" would conflict with a concurrent correction of that column.
-- Since 20260819140000, "UPDATE OF \"soldAt\"" takes the cluster's advisory
-- lock in EXCLUSIVE mode while every SaleItem write holds it in SHARED mode,
-- so a forecast read and a soldAt correction can no longer overlap at all -
-- the row-level share lock now only adds the edge above. Dropping it removes
-- the cycle without weakening the guarantee that produced it.
--
-- "Product" is deliberately left on FOR NO KEY UPDATE. That lock is not about
-- concurrent "consumptionDays" changes (the advisory gate covers those too);
-- it is what stops two SaleItem writes for the same product from taking
-- compatible shared locks and then deadlocking against each other while
-- upgrading to the stock UPDATE in TASK-08. Both writers are the child
-- direction, so the shared gate lets them run concurrently by design, and
-- this lock is what serializes them.
CREATE OR REPLACE FUNCTION "compute_sale_item_expected_repurchase"() RETURNS TRIGGER AS $$
DECLARE
  v_sold_at TIMESTAMP(3);
  v_consumption_days INTEGER;
BEGIN
  SELECT "soldAt"
  INTO v_sold_at
  FROM "Sale"
  WHERE "id" = NEW."saleId";

  SELECT "consumptionDays"
  INTO v_consumption_days
  FROM "Product"
  WHERE "id" = NEW."productId"
  FOR NO KEY UPDATE;

  NEW."expectedRepurchaseAt" := "compute_expected_repurchase_at"(v_sold_at, NEW."quantity", v_consumption_days);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
