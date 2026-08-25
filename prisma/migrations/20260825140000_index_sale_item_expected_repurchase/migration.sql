-- TASK-12: the repurchase dashboard filters every sale item on the stored
-- forecast and orders by it. "SaleItem" only carried indexes on "saleId" and
-- "productId", so the dashboard query would scan the entire sales history on
-- every read, growing without bound as sales accumulate.
--
-- Additive index only. No column, type, nullability or semantics changes, and
-- nothing here touches the TASK-09 trigger web that owns the value: ARCH-01
-- Option A keeps PostgreSQL as the sole author of "expectedRepurchaseAt".
CREATE INDEX "SaleItem_expectedRepurchaseAt_idx" ON "SaleItem"("expectedRepurchaseAt");
