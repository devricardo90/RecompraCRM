-- TASK-07 persists the canonical Sale and SaleItem model only.
-- Stock mutation and repurchase calculation remain in TASK-08 and TASK-09.
CREATE TABLE "Sale" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaleItem" (
    "id" SERIAL NOT NULL,
    "saleId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(65,30),
    "expectedRepurchaseAt" TIMESTAMP(3),

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Sale_customerId_idx" ON "Sale"("customerId");
CREATE INDEX "SaleItem_saleId_idx" ON "SaleItem"("saleId");
CREATE INDEX "SaleItem_productId_idx" ON "SaleItem"("productId");

ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaleItem"
ADD CONSTRAINT "SaleItem_saleId_fkey"
FOREIGN KEY ("saleId") REFERENCES "Sale"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaleItem"
ADD CONSTRAINT "SaleItem_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaleItem"
ADD CONSTRAINT "SaleItem_quantity_positive"
CHECK ("quantity" > 0);

-- A deferred constraint trigger lets Prisma create a Sale and its nested items
-- atomically while preventing a committed Sale from existing without items.
CREATE FUNCTION "ensure_sale_has_items"() RETURNS TRIGGER AS $$
DECLARE
  target_sale_id INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'Sale' THEN
    target_sale_id := NEW."id";
  ELSE
    target_sale_id := OLD."saleId";
  END IF;

  IF EXISTS (SELECT 1 FROM "Sale" WHERE "id" = target_sale_id) THEN
    PERFORM 1 FROM "Sale" WHERE "id" = target_sale_id FOR UPDATE;

    IF NOT EXISTS (SELECT 1 FROM "SaleItem" WHERE "saleId" = target_sale_id) THEN
      RAISE EXCEPTION 'Sale % must contain at least one item', target_sale_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Sale_requires_item"
AFTER INSERT ON "Sale"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "ensure_sale_has_items"();

CREATE CONSTRAINT TRIGGER "SaleItem_preserves_sale_items"
AFTER DELETE OR UPDATE OF "saleId" ON "SaleItem"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "ensure_sale_has_items"();
