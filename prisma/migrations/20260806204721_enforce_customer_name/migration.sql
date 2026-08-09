-- AddCheckConstraint
ALTER TABLE "Customer"
ADD CONSTRAINT "Customer_name_not_blank"
CHECK ("name" ~ '[^[:space:]]') NOT VALID;

-- Existing rows are validated only when no legacy value violates the rule.
-- NOT VALID still enforces the constraint for every new INSERT and UPDATE.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "Customer"
    WHERE "name" !~ '[^[:space:]]'
  ) THEN
    ALTER TABLE "Customer"
    VALIDATE CONSTRAINT "Customer_name_not_blank";
  END IF;
END
$$;
