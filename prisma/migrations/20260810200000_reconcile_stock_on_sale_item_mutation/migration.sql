-- Codex P2: the INSERT-only trigger from the previous migration never
-- reconciled stock when an existing SaleItem's quantity or productId
-- changed, or when one item of a multi-item Sale was deleted while others
-- remained (TASK-07 already permits both: the deferred
-- "SaleItem_preserves_sale_items" trigger only blocks removing the *last*
-- item, and quantity/productId have no immutability constraint). Without
-- this, a committed Sale's items could stop corresponding to the stock
-- actually deducted.
--
-- Restore stock on delete, and reconcile the delta on quantity/productId
-- update. Both mutate Product via a real UPDATE (not app-side
-- read-then-write), preserving the same row-locked concurrency safety as
-- the insert-time reduction, and both feed the existing
-- Product_currentStock_non_negative CHECK constraint so an update/delete
-- that would leave stock negative still fails the whole transaction.
CREATE FUNCTION "restore_product_stock_on_sale_item_delete"() RETURNS TRIGGER AS $$
BEGIN
  UPDATE "Product"
  SET "currentStock" = "currentStock" + OLD."quantity",
      "updatedAt" = clock_timestamp()
  WHERE "id" = OLD."productId";

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SaleItem_restores_product_stock_on_delete"
AFTER DELETE ON "SaleItem"
FOR EACH ROW EXECUTE FUNCTION "restore_product_stock_on_sale_item_delete"();

CREATE FUNCTION "reconcile_product_stock_on_sale_item_update"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."productId" IS DISTINCT FROM OLD."productId" THEN
    UPDATE "Product"
    SET "currentStock" = "currentStock" + OLD."quantity",
        "updatedAt" = clock_timestamp()
    WHERE "id" = OLD."productId";

    UPDATE "Product"
    SET "currentStock" = "currentStock" - NEW."quantity",
        "updatedAt" = clock_timestamp()
    WHERE "id" = NEW."productId";
  ELSIF NEW."quantity" IS DISTINCT FROM OLD."quantity" THEN
    UPDATE "Product"
    SET "currentStock" = "currentStock" - (NEW."quantity" - OLD."quantity"),
        "updatedAt" = clock_timestamp()
    WHERE "id" = NEW."productId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SaleItem_reconciles_product_stock_on_update"
AFTER UPDATE OF "quantity", "productId" ON "SaleItem"
FOR EACH ROW EXECUTE FUNCTION "reconcile_product_stock_on_sale_item_update"();
