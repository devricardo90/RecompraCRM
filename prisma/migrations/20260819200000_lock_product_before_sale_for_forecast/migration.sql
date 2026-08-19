-- TASK-09 review recovery (round 6): take the Product lock before the Sale
-- lock, so the forecast write path and the TASK-08 delete path agree on one
-- order.
--
-- Round 5 made the forecast trigger lock its Sale rows before reading Product.
-- That introduced Sale -> Product in the write path, while the delete path
-- already ran Product -> Sale:
--
--   write path  : the trigger locks "Sale" here, then reads "Product"
--                 FOR NO KEY UPDATE for "consumptionDays".
--   delete path : "SaleItem_restores_product_stock_on_delete" updates
--                 "Product" immediately, and the deferred
--                 "SaleItem_preserves_sale_items" guard updates "Sale" at
--                 COMMIT.
--
-- So an insert or quantity update racing the deletion of another item of the
-- same sale and product deadlocked: the writer held the Sale row and waited
-- for the Product row, while the delete held the Product row and waited, at
-- commit, for that Sale row. Both operations are legal whenever the sale
-- retains an item, and both are the child direction, so the shared advisory
-- gate admits them together by design.
--
-- The delete path cannot be reordered: its Product update is TASK-08's stock
-- restoration, which runs as an AFTER DELETE trigger, and its Sale update is
-- TASK-07's deferred guard, which by construction runs at COMMIT. Product
-- before Sale is therefore the only order both paths can share, so the
-- forecast trigger adopts it.
--
-- The rest of round 5 is unchanged and still required:
--
--   * the Sale rows are still locked FOR NO KEY UPDATE, which is what makes
--     PostgreSQL reject a stale REPEATABLE READ writer with 40001 instead of
--     letting it persist a forecast built on a superseded "soldAt";
--   * a move still locks both the source and the destination sale, lowest id
--     first, so two opposite-direction moves cannot deadlock on each other.
--
-- Ordering Product first does not disturb either property: the sales are still
-- locked among themselves by ascending id, and the whole cluster now has one
-- global order - Product, then Sale by id.
--
-- The parent direction (propagating "soldAt" or "consumptionDays") locks in
-- the opposite order in places, but it holds the cluster's advisory lock in
-- EXCLUSIVE mode, so no child path can be inside at the same time and no cycle
-- with it can form.
CREATE OR REPLACE FUNCTION "compute_sale_item_expected_repurchase"() RETURNS TRIGGER AS $$
DECLARE
  v_sold_at TIMESTAMP(3);
  v_consumption_days INTEGER;
  v_first_sale_id INTEGER;
  v_second_sale_id INTEGER;
BEGIN
  -- Product first: the delete path reaches Product before Sale and cannot be
  -- reordered, so this is the order both paths must share.
  SELECT "consumptionDays"
  INTO v_consumption_days
  FROM "Product"
  WHERE "id" = NEW."productId"
  FOR NO KEY UPDATE;

  IF TG_OP = 'UPDATE' AND OLD."saleId" IS DISTINCT FROM NEW."saleId" THEN
    -- Lowest id first, so opposite-direction moves cannot deadlock.
    v_first_sale_id := LEAST(OLD."saleId", NEW."saleId");
    v_second_sale_id := GREATEST(OLD."saleId", NEW."saleId");
  ELSE
    v_first_sale_id := NEW."saleId";
    v_second_sale_id := NULL;
  END IF;

  PERFORM 1 FROM "Sale" WHERE "id" = v_first_sale_id FOR NO KEY UPDATE;

  IF v_second_sale_id IS NOT NULL THEN
    PERFORM 1 FROM "Sale" WHERE "id" = v_second_sale_id FOR NO KEY UPDATE;
  END IF;

  SELECT "soldAt"
  INTO v_sold_at
  FROM "Sale"
  WHERE "id" = NEW."saleId";

  NEW."expectedRepurchaseAt" := "compute_expected_repurchase_at"(v_sold_at, NEW."quantity", v_consumption_days);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
