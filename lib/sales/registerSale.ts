import { prisma } from "@/lib/prisma";

import { runSaleRegistration, type RegisterSaleInput } from "./saleTransaction";

export {
  MAX_SALE_ATTEMPTS,
  SaleConcurrencyError,
  SaleInvariantError,
  SaleValidationError,
  classifySaleError,
  normalizeSaleItems,
  type RegisterSaleInput,
  type SaleItemInput,
} from "./saleTransaction";

/**
 * The only authorized path that persists Sale/SaleItem in the application.
 *
 * All policy lives in ./saleTransaction so the concurrency harness can drive
 * the same implementation against an isolated database; this wrapper only binds
 * the application's Prisma client.
 */
export async function registerSale(input: RegisterSaleInput) {
  return runSaleRegistration(prisma, input);
}
