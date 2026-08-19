-- TASK-09 review recovery (round 2): eliminate the two remaining P1 deadlock
-- cycles between the forecast propagation paths and the SaleItem write path.
--
-- Two cycles existed, each locking the same pair of tables in opposite order:
--
--   Product  -> SaleItem : UPDATE OF "consumptionDays" locks the Product row,
--                          then "Product_recomputes_item_forecasts_on_consumption_days_update"
--                          updates every referencing SaleItem.
--   SaleItem -> Product  : a SaleItem INSERT/UPDATE/DELETE locks the item row
--                          first, then reads Product FOR NO KEY UPDATE for the
--                          forecast and updates "Product"."currentStock"
--                          through the TASK-08 stock triggers.
--
--   Sale     -> SaleItem : UPDATE OF "soldAt" locks the Sale row, then
--                          "Sale_recomputes_item_forecasts_on_soldAt_update"
--                          updates that sale's items.
--   SaleItem -> Sale     : a SaleItem write locks the item row first, then
--                          reads Sale FOR SHARE for the forecast and updates
--                          the Sale row in the TASK-07 "ensure_sale_has_items"
--                          guard.
--
-- Once the two directions of either pair overlap, PostgreSQL aborts one of
-- them with a deadlock (SQLSTATE 40P01).
--
-- Reordering the row locks cannot fix this. In both cycles the parent row is
-- already locked by the very statement whose AFTER trigger performs the
-- propagation, and the child row is already locked by the statement whose
-- BEFORE trigger reads the parent, so neither side has a point left at which
-- it could take its locks in the other order. The child -> parent direction
-- is also not removable: it is what TASK-07 (the "at least one item" guard)
-- and TASK-08 (stock reconciliation) are built on.
--
-- What is left is to stop the two *directions* from ever overlapping, while
-- still allowing many writers of the same direction. A statement-level BEFORE
-- trigger runs before its statement processes - and therefore locks - any
-- row, which makes it the only remaining point that precedes every row lock.
-- So both directions take the same transaction-scoped advisory lock there,
-- in different modes:
--
--   * SaleItem writes (the child direction) take it in SHARED mode, so they
--     stay concurrent with each other exactly as before. Two sales of the
--     same product, and two removals of different items of the same sale,
--     still interleave and are still arbitrated by the row locks and MVCC
--     conflicts that TASK-07 and TASK-08 rely on.
--   * The two propagating parent statements take it in EXCLUSIVE mode, so
--     while one of them runs no SaleItem write can be inside the cluster,
--     and vice versa. The cycle therefore cannot form.
--
-- Only "UPDATE OF" the propagating column arms the exclusive lock. This
-- matters: TASK-08's stock reconciliation updates "Product"."currentStock"
-- and TASK-07's guard updates "Sale"."updatedAt" from *inside* the child
-- direction, and those statements must not try to upgrade the shared lock
-- they already hold into an exclusive one. Because neither statement names
-- "consumptionDays" or "soldAt", neither trigger fires for them.
--
-- Advisory locks never conflict with the transaction that already holds
-- them, so the parent direction re-entering the SaleItem trigger through its
-- own propagation UPDATE is granted immediately.
--
-- Residual, deliberately not covered: a single transaction that both writes a
-- SaleItem and updates "consumptionDays"/"soldAt" would request an exclusive
-- lock while holding the shared one. Two such transactions racing would be
-- aborted by PostgreSQL as a normal, retryable deadlock rather than
-- corrupting anything. No application path performs that combination - the
-- product and sale routes are separate transactions.
CREATE FUNCTION "lock_sale_forecast_cluster_shared"() RETURNS TRIGGER AS $$
BEGIN
  -- Arbitrary but stable key identifying the Sale/SaleItem/Product forecast
  -- cluster. It must be identical in both functions below.
  PERFORM pg_advisory_xact_lock_shared(776755092);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "lock_sale_forecast_cluster_exclusive"() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(776755092);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Child direction: INSERT, UPDATE and DELETE all read Sale/Product for the
-- forecast and reconcile Product stock, so all three enter the cluster.
CREATE TRIGGER "SaleItem_enters_forecast_cluster"
BEFORE INSERT OR UPDATE OR DELETE ON "SaleItem"
FOR EACH STATEMENT EXECUTE FUNCTION "lock_sale_forecast_cluster_shared"();

-- Parent direction: only the two statements that propagate into SaleItem.
CREATE TRIGGER "Sale_locks_forecast_cluster_on_soldAt_update"
BEFORE UPDATE OF "soldAt" ON "Sale"
FOR EACH STATEMENT EXECUTE FUNCTION "lock_sale_forecast_cluster_exclusive"();

CREATE TRIGGER "Product_locks_forecast_cluster_on_consumption_days_update"
BEFORE UPDATE OF "consumptionDays" ON "Product"
FOR EACH STATEMENT EXECUTE FUNCTION "lock_sale_forecast_cluster_exclusive"();
