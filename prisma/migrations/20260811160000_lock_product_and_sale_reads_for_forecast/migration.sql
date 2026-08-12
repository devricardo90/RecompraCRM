-- Codex found a race between inserting a SaleItem and concurrently updating
-- its Product's consumptionDays (or its Sale's soldAt). The SaleItem
-- trigger read both via a plain SELECT with no lock, so it doesn't
-- participate in PostgreSQL's conflict detection at all: the FOR KEY SHARE
-- lock the SaleItem's foreign keys already take only protects the
-- referenced rows' key columns, not non-key ones like consumptionDays or
-- soldAt, so a concurrent UPDATE of those columns is never blocked or
-- detected. Both transactions can commit, leaving the new item permanently
-- forecast from the stale value.
--
-- Add FOR SHARE to both reads: it conflicts with a concurrent plain UPDATE
-- (which takes an implicit FOR NO KEY UPDATE-equivalent lock), so whichever
-- transaction reaches the row first, the other waits instead of racing.
-- Either winning order still ends correctly: if the SaleItem insert waits,
-- it reads the fresh value directly; if the Product/Sale update waits, it
-- commits after the insert and its own propagation trigger (added in prior
-- migrations) then finds and corrects the just-inserted item.
CREATE OR REPLACE FUNCTION "compute_sale_item_expected_repurchase"() RETURNS TRIGGER AS $$
DECLARE
  v_sold_at TIMESTAMP(3);
  v_consumption_days INTEGER;
BEGIN
  SELECT "soldAt" INTO v_sold_at FROM "Sale" WHERE "id" = NEW."saleId" FOR SHARE;
  SELECT "consumptionDays" INTO v_consumption_days FROM "Product" WHERE "id" = NEW."productId" FOR SHARE;

  NEW."expectedRepurchaseAt" := "compute_expected_repurchase_at"(v_sold_at, NEW."quantity", v_consumption_days);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
