-- AddCheckConstraint
ALTER TABLE "Customer"
ADD CONSTRAINT "Customer_name_not_blank"
CHECK ("name" ~ '[^[:space:]]');
