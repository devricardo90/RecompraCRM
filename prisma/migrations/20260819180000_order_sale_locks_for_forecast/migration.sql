-- TASK-09 review recovery (round 5): make the Sale read locking again -
-- strongly enough to reject a stale snapshot - while keeping the round-4
-- cross-sale cycle closed, by locking the sales involved in a fixed order.
--
-- Round 4 dropped the Sale FOR SHARE because the advisory gate already stops a
-- forecast read from overlapping a "soldAt" correction. That holds for overlap
-- in time, but it is not enough for a REPEATABLE READ writer:
--
--   1. a REPEATABLE READ transaction takes its snapshot;
--   2. a "soldAt" correction commits - it holds the cluster lock exclusively,
--      so it never runs at the same instant as the write below, but it can
--      perfectly well have committed just before it;
--   3. the writer then inserts an item, or moves one into that sale, and a
--      plain SELECT still serves the pre-correction "soldAt" from its own
--      snapshot, persisting a forecast against a superseded sale date.
--
-- The parent's propagation cannot repair that row: it was not attached to the
-- sale when the propagation ran, so nothing would ever correct it.
--
-- Only a row lock that *conflicts with a non-key UPDATE* fixes this. At
-- REPEATABLE READ PostgreSQL then refuses to lock a row a concurrent
-- transaction has updated since the snapshot and raises a serialization
-- failure (40001), rejecting the stale writer instead of letting it persist a
-- wrong forecast; at READ COMMITTED the locking read follows the update chain
-- and sees the corrected date.
--
-- FOR KEY SHARE is *not* sufficient here, despite being the obvious candidate:
-- correcting "soldAt" is a non-key update, KEY SHARE does not conflict with
-- it, so PostgreSQL locks the newer version without raising anything and the
-- stale snapshot is still served. This was confirmed against a real database
-- before choosing the lock below.
--
-- FOR SHARE is what round 4 had to remove: it conflicts with FOR NO KEY
-- UPDATE, which is exactly what the deferred "SaleItem_preserves_sale_items"
-- guard takes when it updates the *source* sale's "updatedAt", so two
-- opposite-direction cross-sale moves each blocked the other.
--
-- What actually reconciles the two is not a weaker lock but a fixed lock
-- order. A move touches two sale rows - the destination it reads, and the
-- source the deferred guard updates - so the trigger locks both up front with
-- FOR NO KEY UPDATE, always lowest id first. Two transactions moving items in
-- opposite directions between the same pair therefore request the same rows in
-- the same order and one simply waits for the other; no cycle can form. Every
-- other case touches a single sale and locks just that one.
--
-- The trigger fires only on INSERT and on UPDATE OF "quantity"/"productId"/
-- "saleId", never on DELETE, so TASK-07's concurrent removal of two different
-- items of one sale keeps arbitrating exactly as before, through that guard's
-- own UPDATE rather than through this lock.
--
-- "Product" needs no equivalent change: its read already uses FOR NO KEY
-- UPDATE, which both fails a stale REPEATABLE READ writer the same way and
-- serializes same-direction writers before TASK-08's stock UPDATE.
CREATE OR REPLACE FUNCTION "compute_sale_item_expected_repurchase"() RETURNS TRIGGER AS $$
DECLARE
  v_sold_at TIMESTAMP(3);
  v_consumption_days INTEGER;
  v_first_sale_id INTEGER;
  v_second_sale_id INTEGER;
BEGIN
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

  SELECT "consumptionDays"
  INTO v_consumption_days
  FROM "Product"
  WHERE "id" = NEW."productId"
  FOR NO KEY UPDATE;

  NEW."expectedRepurchaseAt" := "compute_expected_repurchase_at"(v_sold_at, NEW."quantity", v_consumption_days);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
