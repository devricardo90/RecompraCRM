import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * The only authorized path that persists Sale/SaleItem.
 *
 * TASK-09 left one accepted residual: the forecast trigger web orders its locks
 * per affected row, not per statement, so a multi-row SaleItem statement can
 * lock a Sale for one row and only then reach a Product for the next. A
 * concurrent item deletion closes that into a retryable 40P01.
 *
 * TASK-10's spec answers it with two strategies, and both live here rather than
 * in the route, so no caller can assemble a different write shape:
 *
 *   A. one interactive transaction, items sorted by ascending productId, one
 *      SaleItem per statement -- never createMany or a nested create, which
 *      both emit a multi-row statement;
 *   B. the whole transaction retried up to 3 attempts, but only for 40P01 and
 *      40001.
 */

/** Retryable PostgreSQL concurrency failures. Nothing else may be retried. */
const DEADLOCK_DETECTED = "40P01";
const SERIALIZATION_FAILURE = "40001";
const RETRYABLE_SQLSTATES = new Set([DEADLOCK_DETECTED, SERIALIZATION_FAILURE]);

/** Domain invariants from TASK-07/08/09 surface as these; they are deterministic answers, not contention. */
const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";

export const MAX_SALE_ATTEMPTS = 3;
/** Short, bounded, jitter-free so the concurrency harness stays deterministic. */
const RETRY_DELAY_MS = [20, 40];

export type SaleItemInput = { productId: number; quantity: number };

export type RegisterSaleInput = {
  customerId: number;
  soldAt: Date;
  status: string;
  notes?: string | null;
  items: SaleItemInput[];
};

/** Raised only when every attempt hit a retryable concurrency failure. */
export class SaleConcurrencyError extends Error {
  constructor(
    readonly sqlState: string,
    readonly attempts: number,
  ) {
    super(
      `A venda não pôde ser registrada após ${attempts} tentativas por concorrência no banco (${sqlState}).`,
    );
    this.name = "SaleConcurrencyError";
  }
}

/** Raised when the database rejected the sale on a domain invariant. Never retried. */
export class SaleInvariantError extends Error {
  constructor(
    message: string,
    readonly sqlState: string,
  ) {
    super(message);
    this.name = "SaleInvariantError";
  }
}

function sqlStateOf(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta as { code?: unknown } | undefined;
    if (typeof meta?.code === "string") return meta.code;
  }

  // Raw/engine errors surface the SQLSTATE in the message rather than in meta.
  const message = error instanceof Error ? error.message : "";
  const named = message.match(/\b(?:code|SQLSTATE)[^0-9A-Za-z]{0,3}([0-9A-Z]{5})\b/);
  return named ? named[1] : null;
}

export function isRetryableSaleError(error: unknown): boolean {
  const state = sqlStateOf(error);
  return state !== null && RETRYABLE_SQLSTATES.has(state);
}

/**
 * Collapses repeated selections of the same product into a single item and
 * sorts by ascending productId.
 *
 * Both halves matter. Summing keeps one row per product, so a single
 * transaction never has two SaleItems contending for the same Product row.
 * Sorting matches the order the forecast trigger locks Product rows in, so two
 * concurrent sales sharing products request them in the same relative order.
 */
export function normalizeSaleItems(items: SaleItemInput[]): SaleItemInput[] {
  const merged = new Map<number, number>();
  for (const item of items) {
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
  }

  return [...merged.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => a.productId - b.productId);
}

function describeInvariant(error: unknown, sqlState: string): string {
  const message = error instanceof Error ? error.message : "";
  if (sqlState === FOREIGN_KEY_VIOLATION) {
    return "Cliente ou produto informado não existe mais.";
  }
  if (/Product_currentStock_non_negative/.test(message)) {
    return "Estoque insuficiente para concluir a venda.";
  }
  if (/SaleItem_quantity_positive|quantity/.test(message)) {
    return "A quantidade de cada item deve ser maior que zero.";
  }
  if (/must contain at least one item/.test(message)) {
    return "A venda precisa de pelo menos um item.";
  }
  return "A venda viola uma regra do sistema e não pôde ser registrada.";
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Registers a sale atomically, retrying the WHOLE transaction on retryable
 * concurrency failures. A failed attempt leaves nothing behind: PostgreSQL
 * rolls the transaction back, so the retry starts from scratch rather than
 * continuing from partial state, and a successful retry still yields exactly
 * one sale.
 */
export async function registerSale(input: RegisterSaleInput) {
  const items = normalizeSaleItems(input.items);
  let lastSqlState = DEADLOCK_DETECTED;

  for (let attempt = 1; attempt <= MAX_SALE_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const sale = await tx.sale.create({
          data: {
            customerId: input.customerId,
            soldAt: input.soldAt,
            status: input.status,
            notes: input.notes ?? null,
          },
        });

        // One statement per item, in ascending productId order. Deliberately a
        // loop and not createMany: createMany emits a single multi-row
        // statement, which is the shape TASK-09's residual is about.
        for (const item of items) {
          await tx.saleItem.create({
            data: {
              saleId: sale.id,
              productId: item.productId,
              quantity: item.quantity,
              // expectedRepurchaseAt is deliberately absent: it is derived in
              // the database and recomputed even if written directly.
            },
          });
        }

        return tx.sale.findUniqueOrThrow({
          where: { id: sale.id },
          include: {
            customer: true,
            items: { include: { product: true }, orderBy: { productId: "asc" } },
          },
        });
      });
    } catch (error) {
      const sqlState = sqlStateOf(error);

      if (sqlState !== null && RETRYABLE_SQLSTATES.has(sqlState)) {
        lastSqlState = sqlState;
        if (attempt < MAX_SALE_ATTEMPTS) {
          await delay(RETRY_DELAY_MS[attempt - 1] ?? RETRY_DELAY_MS.at(-1) ?? 0);
          continue;
        }
        // Exhausted: surface it rather than swallowing it.
        throw new SaleConcurrencyError(sqlState, MAX_SALE_ATTEMPTS);
      }

      if (sqlState === CHECK_VIOLATION || sqlState === FOREIGN_KEY_VIOLATION) {
        throw new SaleInvariantError(describeInvariant(error, sqlState), sqlState);
      }

      // Anything else is not ours to interpret: fail immediately, unchanged.
      throw error;
    }
  }

  throw new SaleConcurrencyError(lastSqlState, MAX_SALE_ATTEMPTS);
}
