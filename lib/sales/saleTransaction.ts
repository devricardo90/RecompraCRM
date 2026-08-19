import { Prisma } from "@prisma/client";

/**
 * The sale registration transaction: normalization, write shape, error
 * classification and bounded retry.
 *
 * This module deliberately imports no Prisma singleton and uses no path alias,
 * so the concurrency harness can import and drive *this* implementation against
 * an isolated database instead of testing a copy of it. A harness that
 * reimplements the policy proves nothing about production.
 */

/** Retryable PostgreSQL concurrency failures. Nothing else may be retried. */
const DEADLOCK_DETECTED = "40P01";
const SERIALIZATION_FAILURE = "40001";
const RETRYABLE_SQLSTATES = new Set([DEADLOCK_DETECTED, SERIALIZATION_FAILURE]);

/**
 * Prisma collapses a real 40P01/40001 raised by a typed write into P2034 and
 * drops the SQLSTATE. Treating that as fatal would silently disable the whole
 * retry policy for exactly the writes it exists to protect.
 */
const PRISMA_WRITE_CONFLICT = "P2034";
const PRISMA_FOREIGN_KEY = "P2003";

/** Domain invariants from TASK-07/08/09: deterministic answers, never retried. */
const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";

export const MAX_SALE_ATTEMPTS = 3;
/** Short, bounded, jitter-free so the concurrency harness stays deterministic. */
export const RETRY_DELAY_MS = [20, 40];

export const POSTGRES_INTEGER_MAX = 2_147_483_647;

export type SaleItemInput = { productId: number; quantity: number };

export type RegisterSaleInput = {
  customerId: number;
  soldAt: Date;
  status: string;
  notes?: string | null;
  items: SaleItemInput[];
};

/** Test instrumentation. Production callers never pass this. */
export type SaleTransactionHooks = {
  beforeItems?: (attempt: number, saleId: number, tx: unknown) => Promise<void>;
};

export class SaleConcurrencyError extends Error {
  // Explicit fields rather than TypeScript parameter properties: the
  // concurrency harness imports this module directly under Node's strip-only
  // type stripping, which does not support parameter properties.
  readonly sqlState: string;
  readonly attempts: number;

  constructor(sqlState: string, attempts: number) {
    super(
      `A venda não pôde ser registrada após ${attempts} tentativas por concorrência no banco (${sqlState}).`,
    );
    this.name = "SaleConcurrencyError";
    this.sqlState = sqlState;
    this.attempts = attempts;
  }
}

export class SaleInvariantError extends Error {
  readonly sqlState: string;

  constructor(message: string, sqlState: string) {
    super(message);
    this.name = "SaleInvariantError";
    this.sqlState = sqlState;
  }
}

/** Input that cannot be persisted at all, detected before opening a transaction. */
export class SaleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaleValidationError";
  }
}

function prismaCodeOf(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^P\d{4}$/.test(code) ? code : null;
}

function sqlStateOf(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta as { code?: unknown } | undefined;
    if (typeof meta?.code === "string") return meta.code;
  }

  // Raw/engine errors carry the SQLSTATE in the message rather than in meta.
  const message = error instanceof Error ? error.message : "";
  const named = message.match(/\b(?:code|SQLSTATE)[^0-9A-Za-z]{0,3}([0-9A-Z]{5})\b/);
  return named ? named[1] : null;
}

/**
 * Retryable when PostgreSQL says so, or when Prisma normalized it into its
 * write-conflict/deadlock code and threw the SQLSTATE away.
 */
export function classifySaleError(error: unknown): "retryable" | "invariant" | "fatal" {
  const sqlState = sqlStateOf(error);
  if (sqlState !== null && RETRYABLE_SQLSTATES.has(sqlState)) return "retryable";

  const prismaCode = prismaCodeOf(error);
  if (prismaCode === PRISMA_WRITE_CONFLICT) return "retryable";
  if (prismaCode === PRISMA_FOREIGN_KEY) return "invariant";

  if (sqlState === CHECK_VIOLATION || sqlState === FOREIGN_KEY_VIOLATION) return "invariant";
  return "fatal";
}

function retryableStateOf(error: unknown): string {
  return sqlStateOf(error) ?? prismaCodeOf(error) ?? DEADLOCK_DETECTED;
}

/**
 * Collapses repeated selections of the same product into one item and sorts by
 * ascending productId.
 *
 * Summing keeps one row per product, so a single transaction never has two
 * SaleItems contending for the same Product row. Sorting matches the order the
 * forecast trigger locks Product rows in, so two concurrent sales sharing
 * products request them in the same relative order.
 */
export function normalizeSaleItems(items: SaleItemInput[]): SaleItemInput[] {
  const merged = new Map<number, number>();
  for (const item of items) {
    const total = (merged.get(item.productId) ?? 0) + item.quantity;

    // Two lines can each be individually valid while their sum is not. Catch it
    // here rather than letting an oversized value reach the database as a
    // generic failure. Safe-integer first: beyond 2^53 the sum itself lies.
    if (!Number.isSafeInteger(total) || total > POSTGRES_INTEGER_MAX) {
      throw new SaleValidationError(
        `A quantidade total de um produto deve ser um número inteiro entre 1 e ${POSTGRES_INTEGER_MAX}.`,
      );
    }

    merged.set(item.productId, total);
  }

  return [...merged.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => a.productId - b.productId);
}

function describeInvariant(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const sqlState = sqlStateOf(error);
  const prismaCode = prismaCodeOf(error);

  if (sqlState === FOREIGN_KEY_VIOLATION || prismaCode === PRISMA_FOREIGN_KEY) {
    return "Cliente ou produto informado não existe mais.";
  }
  if (/Product_currentStock_non_negative/.test(message)) {
    return "Estoque insuficiente para concluir a venda.";
  }
  if (/quantity/i.test(message)) {
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

/** Minimal shape of the client this needs, so the harness can pass its own. */
export type SaleClient = {
  $transaction<R>(
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
    options?: { timeout?: number; maxWait?: number },
  ): Promise<R>;
};

/**
 * Registers a sale atomically, retrying the WHOLE transaction on retryable
 * concurrency failures. A failed attempt leaves nothing behind: PostgreSQL
 * rolls it back, so a retry starts from scratch rather than continuing from
 * partial state, and a successful retry still yields exactly one sale.
 */
export async function runSaleRegistration(
  client: SaleClient,
  input: RegisterSaleInput,
  options: { hooks?: SaleTransactionHooks; transactionTimeoutMs?: number } = {},
) {
  const items = normalizeSaleItems(input.items);
  const timeout = options.transactionTimeoutMs ?? 15000;
  let lastState = DEADLOCK_DETECTED;

  for (let attempt = 1; attempt <= MAX_SALE_ATTEMPTS; attempt += 1) {
    try {
      return await client.$transaction(
        async (tx) => {
          const sale = await tx.sale.create({
            data: {
              customerId: input.customerId,
              soldAt: input.soldAt,
              status: input.status,
              notes: input.notes ?? null,
            },
          });

          if (options.hooks?.beforeItems) {
            await options.hooks.beforeItems(attempt, sale.id, tx);
          }

          // One statement per item, ascending productId. Deliberately a loop:
          // createMany emits a single multi-row statement, which is the shape
          // TASK-09's accepted residual is about.
          for (const item of items) {
            await tx.saleItem.create({
              data: {
                saleId: sale.id,
                productId: item.productId,
                quantity: item.quantity,
                // expectedRepurchaseAt is deliberately absent: derived in the
                // database and recomputed even if written directly.
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
        },
        { timeout, maxWait: timeout },
      );
    } catch (error) {
      const kind = classifySaleError(error);

      if (kind === "retryable") {
        lastState = retryableStateOf(error);
        if (attempt < MAX_SALE_ATTEMPTS) {
          await delay(RETRY_DELAY_MS[attempt - 1] ?? RETRY_DELAY_MS.at(-1) ?? 0);
          continue;
        }
        throw new SaleConcurrencyError(lastState, MAX_SALE_ATTEMPTS);
      }

      if (kind === "invariant") {
        throw new SaleInvariantError(
          describeInvariant(error),
          sqlStateOf(error) ?? prismaCodeOf(error) ?? FOREIGN_KEY_VIOLATION,
        );
      }

      // Not ours to interpret: fail immediately, unchanged.
      throw error;
    }
  }

  throw new SaleConcurrencyError(lastState, MAX_SALE_ATTEMPTS);
}
