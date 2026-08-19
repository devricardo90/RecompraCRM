-- TASK-09 review recovery (round 7): a productId reassignment touches two
-- Product rows, so both must be locked - in a deterministic order - before any
-- Sale row.
--
-- Round 6 established Product before Sale, but locked only NEW."productId".
-- TASK-08's "reconcile_product_stock_on_sale_item_update" afterwards updates
-- *both* products: it restores stock to OLD."productId" and charges
-- NEW."productId". So a reassignment reached the old product only after the
-- Sale, which put Sale -> Product back into the write path for that mutation:
--
--   reassignment : locks NEW product, then Sale, then waits for OLD product
--                  in the AFTER stock trigger.
--   delete       : holds OLD product from
--                  "SaleItem_restores_product_stock_on_delete", then waits for
--                  the Sale in the deferred "SaleItem_preserves_sale_items"
--                  guard at COMMIT.
--
-- Deleting another item of the same sale and old product is legal whenever the
-- sale retains an item, and both operations are the child direction, so the
-- shared advisory gate admits them together and PostgreSQL aborted one with
-- 40P01.
--
-- Locking both products up front, lowest id first, closes it. The order this
-- establishes is per affected row:
--
--   every Product *this row* touches, by ascending id,
--   then every Sale *this row* touches, by ascending id.
--
-- Two concurrent reassignments that share a product therefore request it in
-- the same relative order, and the delete path - which only ever touches one
-- product and one sale, in that order - is a prefix of it.
--
-- Scope, stated precisely: this is a per-row guarantee, not a per-statement or
-- per-transaction one. A statement that changes several SaleItems, or a
-- transaction that writes several items in separate statements, fires this
-- trigger once per row, so it can lock a Sale for one row and only then reach
-- a Product for the next. A concurrent delete holding that Product and waiting
-- for that Sale still forms a cycle, and PostgreSQL aborts one side with
-- 40P01.
--
-- That residual is deliberate, because the two ways to remove it are both
-- worse here:
--
--   * statement-wide prelocking would need the set of affected rows before any
--     row is locked, and PostgreSQL exposes transition tables only to AFTER
--     triggers - by then the locks are already taken;
--   * serializing child statements against each other reintroduces the global
--     mutex that round 3 already tried and had to abandon, because it makes
--     the TASK-07 case impossible by construction: two transactions must be
--     able to each remove a different item of the same sale before either
--     commits.
--
-- The residual therefore surfaces as a normal, retryable serialization error
-- rather than as data corruption, and no current application path issues
-- multi-item SaleItem writes - the sale registration flow arrives in TASK-10
-- and should keep one item per statement, or retry on 40P01.
--
-- Everything the previous rounds established is preserved: the sale rows are
-- still locked FOR NO KEY UPDATE, which is what rejects a stale
-- REPEATABLE READ writer with 40001, and a move across sales still locks both
-- sale rows lowest id first.
CREATE OR REPLACE FUNCTION "compute_sale_item_expected_repurchase"() RETURNS TRIGGER AS $$
DECLARE
  v_sold_at TIMESTAMP(3);
  v_consumption_days INTEGER;
  v_first_product_id INTEGER;
  v_second_product_id INTEGER;
  v_first_sale_id INTEGER;
  v_second_sale_id INTEGER;
BEGIN
  -- Every Product this statement can touch, lowest id first. A reassignment
  -- also charges the old product back through TASK-08's stock reconciliation.
  IF TG_OP = 'UPDATE' AND OLD."productId" IS DISTINCT FROM NEW."productId" THEN
    v_first_product_id := LEAST(OLD."productId", NEW."productId");
    v_second_product_id := GREATEST(OLD."productId", NEW."productId");
  ELSE
    v_first_product_id := NEW."productId";
    v_second_product_id := NULL;
  END IF;

  PERFORM 1 FROM "Product" WHERE "id" = v_first_product_id FOR NO KEY UPDATE;

  IF v_second_product_id IS NOT NULL THEN
    PERFORM 1 FROM "Product" WHERE "id" = v_second_product_id FOR NO KEY UPDATE;
  END IF;

  -- Then every Sale, lowest id first, so opposite-direction moves cannot
  -- deadlock on each other.
  IF TG_OP = 'UPDATE' AND OLD."saleId" IS DISTINCT FROM NEW."saleId" THEN
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
  WHERE "id" = NEW."productId";

  NEW."expectedRepurchaseAt" := "compute_expected_repurchase_at"(v_sold_at, NEW."quantity", v_consumption_days);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
