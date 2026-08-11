-- TASK-08: sale confirmation reduces stock atomically and stock never goes
-- negative. The reduction is a single UPDATE that operates on the row's
-- current committed value under row-level locking, not an app-side
-- read-then-write, so concurrent sales of the same Product serialize
-- correctly instead of racing. The CHECK constraint makes "would go
-- negative" fail the triggering INSERT immediately, which aborts the whole
-- transaction (Sale + every SaleItem + every stock reduction), satisfying
-- "falha sem atualização parcial" regardless of item order.
ALTER TABLE "Product"
ADD CONSTRAINT "Product_currentStock_non_negative"
CHECK ("currentStock" >= 0);

CREATE FUNCTION "reduce_product_stock_on_sale_item"() RETURNS TRIGGER AS $$
BEGIN
  UPDATE "Product"
  SET "currentStock" = "currentStock" - NEW."quantity",
      "updatedAt" = clock_timestamp()
  WHERE "id" = NEW."productId";

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SaleItem_reduces_product_stock"
AFTER INSERT ON "SaleItem"
FOR EACH ROW EXECUTE FUNCTION "reduce_product_stock_on_sale_item"();
