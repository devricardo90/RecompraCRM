-- Product domain model for TASK-05.
-- The constraints persist the SDD invariants needed by later stock and
-- replenishment tasks without introducing those future workflows here.
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "currentStock" INTEGER NOT NULL,
    "minimumStock" INTEGER NOT NULL,
    "consumptionDays" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Product"
ADD CONSTRAINT "Product_name_not_blank"
CHECK ("name" ~ E'[^ \\t\\n\\r\\x0B\\x0C\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]');

ALTER TABLE "Product"
ADD CONSTRAINT "Product_unit_not_blank"
CHECK ("unit" ~ E'[^ \\t\\n\\r\\x0B\\x0C\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]');

ALTER TABLE "Product"
ADD CONSTRAINT "Product_current_stock_non_negative"
CHECK ("currentStock" >= 0);

ALTER TABLE "Product"
ADD CONSTRAINT "Product_minimum_stock_non_negative"
CHECK ("minimumStock" >= 0);

ALTER TABLE "Product"
ADD CONSTRAINT "Product_consumption_days_positive"
CHECK ("consumptionDays" > 0);
