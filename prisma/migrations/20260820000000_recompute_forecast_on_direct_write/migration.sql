-- TASK-09 review recovery (round 9): make "expectedRepurchaseAt" behave as the
-- derived column it is meant to be.
--
-- The forecast trigger fired on INSERT and on UPDATE OF
-- "quantity"/"productId"/"saleId", but not on updates of the forecast column
-- itself, while the Prisma schema exposes it as a writable nullable field. A
-- caller updating only that column therefore stored an arbitrary value, which
-- survived until one of the formula inputs happened to change - silently
-- bypassing the persistence-layer computation this task exists to guarantee.
--
-- Adding "expectedRepurchaseAt" to the trigger's column list closes it: any
-- attempt to write the column recomputes it from "Sale"."soldAt",
-- "SaleItem"."quantity" and "Product"."consumptionDays", so the caller's value
-- is replaced by the canonical one rather than persisted. Recomputing is
-- preferred over rejecting because the two propagation triggers update this
-- very column, and rejecting would break them.
--
-- This has to be a separate, later migration rather than an edit to
-- 20260811110000. That migration's column list is also in force while
-- 20260811130000 runs its one-time legacy backfill, which is itself an
-- UPDATE of "expectedRepurchaseAt". Arming the trigger for that statement
-- would route every historical row through the strict helper and abort
-- deployment on exactly the unrepresentable legacy data the backfill is
-- designed to tolerate.
DROP TRIGGER "SaleItem_computes_expected_repurchase" ON "SaleItem";

CREATE TRIGGER "SaleItem_computes_expected_repurchase"
BEFORE INSERT OR UPDATE OF "quantity", "productId", "saleId", "expectedRepurchaseAt" ON "SaleItem"
FOR EACH ROW EXECUTE FUNCTION "compute_sale_item_expected_repurchase"();
