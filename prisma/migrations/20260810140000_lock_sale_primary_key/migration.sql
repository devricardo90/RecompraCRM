-- A deferred COMMIT-time trigger cannot see a Sale that changed primary key
-- mid-transaction: it still finds the row under the old id (now missing) and
-- the row under the new id can then reach COMMIT without any SaleItem,
-- violating "every persisted Sale has at least one item". Sale.id must never
-- change after insert, so reject the UPDATE immediately instead of relying on
-- the deferred check to catch it.
CREATE FUNCTION "block_sale_id_mutation"() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'Sale.id is immutable and cannot be updated'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Sale_id_immutable"
BEFORE UPDATE OF "id" ON "Sale"
FOR EACH ROW EXECUTE FUNCTION "block_sale_id_mutation"();
