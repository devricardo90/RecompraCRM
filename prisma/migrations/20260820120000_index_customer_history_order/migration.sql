-- TASK-11: the customer history pages with a lexicographic seek over
-- (customerId, soldAt DESC, id DESC). "Sale" only carried an index on
-- "customerId", so every page would scan and sort that customer's sales --
-- `limit` would bound the response size but not the repeated query work, on a
-- history the spec explicitly treats as unbounded.
--
-- Additive index only: no data is touched and nothing here interacts with the
-- TASK-07/08/09 trigger web.
CREATE INDEX "Sale_customerId_soldAt_id_idx" ON "Sale"("customerId", "soldAt", "id");
