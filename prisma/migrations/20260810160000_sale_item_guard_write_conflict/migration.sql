-- Codex P2: `PERFORM ... FOR UPDATE` alone never writes to the Sale row, so it
-- creates no MVCC conflict. Under REPEATABLE READ, two transactions that each
-- delete a different item from the same two-item Sale both evaluate the
-- "has items" check against their own transaction-start snapshot: each still
-- sees the item the *other* transaction is deleting, so both pass and both
-- commit, leaving the Sale without any items.
--
-- Replace the read-only lock with an actual UPDATE of the Sale row. At
-- REPEATABLE READ/SERIALIZABLE, PostgreSQL raises a serialization failure
-- (SQLSTATE 40001) when a transaction tries to update a row that a concurrent
-- transaction has already committed a change to, so the second transaction to
-- reach commit is rejected instead of silently succeeding. At READ COMMITTED
-- the behaviour is unchanged (blocks on the row lock, then re-reads fresh
-- data).
CREATE OR REPLACE FUNCTION "ensure_sale_has_items"() RETURNS TRIGGER AS $$
DECLARE
  target_sale_id INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'Sale' THEN
    target_sale_id := NEW."id";
  ELSE
    target_sale_id := OLD."saleId";
  END IF;

  IF EXISTS (SELECT 1 FROM "Sale" WHERE "id" = target_sale_id) THEN
    UPDATE "Sale" SET "updatedAt" = clock_timestamp() WHERE "id" = target_sale_id;

    IF NOT EXISTS (SELECT 1 FROM "SaleItem" WHERE "saleId" = target_sale_id) THEN
      RAISE EXCEPTION 'Sale % must contain at least one item', target_sale_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
