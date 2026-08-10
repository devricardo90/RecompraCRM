-- Codex P2: SaleItem_productId_fkey uses ON UPDATE CASCADE, so a
-- Product.id rename cascades into an UPDATE on every referencing SaleItem.
-- That UPDATE fires the stock-reconciliation trigger from the previous
-- migration, which then tries to "restore" stock to the *old* id (already
-- gone - the row was renamed, not deleted, so the restoring UPDATE matches
-- zero rows) and "reduce" stock from the *new* id (the same physical row,
-- now double-charged for a reassignment that never actually happened).
--
-- Product.id is a surrogate autoincrement key with no legitimate reason to
-- change after creation - mirrors the Sale.id immutability fix from
-- TASK-07. Blocking the rename outright removes the ambiguity between "cascaded
-- rename" and "genuine SaleItem reassignment" entirely, rather than trying
-- to distinguish them in the trigger.
CREATE FUNCTION "block_product_id_mutation"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'Product.id is immutable and cannot be updated'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Product_id_immutable"
BEFORE UPDATE OF "id" ON "Product"
FOR EACH ROW EXECUTE FUNCTION "block_product_id_mutation"();
