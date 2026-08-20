import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * Customer history read model (TASK-11).
 *
 * A read-only projection: it never writes Sale or SaleItem. Any future write
 * still has to go through lib/sales/saleTransaction.ts, which owns the
 * deterministic write shape and the retry policy.
 *
 * Policy lives here rather than in the route so the deterministic harness can
 * drive the same implementation against an isolated database, which is the rule
 * TASK-10 established after its harness was found testing a private copy.
 */

export const DEFAULT_HISTORY_LIMIT = 20;
export const MAX_HISTORY_LIMIT = 50;

export class CustomerHistoryError extends Error {
  readonly kind: "invalid" | "not_found";

  constructor(kind: "invalid" | "not_found", message: string) {
    super(message);
    this.name = "CustomerHistoryError";
    this.kind = kind;
  }
}

export function parseHistoryLimit(raw: string | null): number {
  if (raw === null || raw === "") return DEFAULT_HISTORY_LIMIT;
  if (!/^\d+$/.test(raw)) {
    throw new CustomerHistoryError("invalid", "O limite deve ser um número inteiro.");
  }
  const limit = Number(raw);
  if (limit < 1 || limit > MAX_HISTORY_LIMIT) {
    throw new CustomerHistoryError(
      "invalid",
      `O limite deve estar entre 1 e ${MAX_HISTORY_LIMIT}.`,
    );
  }
  return limit;
}

export function parseHistoryCursor(raw: string | null): number | null {
  if (raw === null || raw === "") return null;
  if (!/^\d+$/.test(raw)) {
    throw new CustomerHistoryError("invalid", "Cursor inválido.");
  }
  const cursor = Number(raw);
  if (cursor < 1 || cursor > 2_147_483_647) {
    throw new CustomerHistoryError("invalid", "Cursor inválido.");
  }
  return cursor;
}

type HistoryClient = Pick<PrismaClient, "customer" | "sale">;

/**
 * One page of a customer's history.
 *
 * The seek is composite. `Sale.id` alone cannot bound an order over
 * (soldAt DESC, id DESC), because soldAt is caller-supplied: a backdated sale
 * makes id order disagree with soldAt order, and an `id < cursor` filter would
 * then skip or repeat valid rows while still looking like a cursor.
 */
export async function readCustomerHistory(
  client: HistoryClient,
  customerId: number,
  options: { limit?: number; cursor?: number | null } = {},
) {
  const limit = options.limit ?? DEFAULT_HISTORY_LIMIT;
  const cursor = options.cursor ?? null;

  const customer = await client.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    throw new CustomerHistoryError("not_found", "Cliente não encontrado.");
  }

  let boundary: { soldAt: Date; id: number } | null = null;
  if (cursor !== null) {
    const cursorSale = await client.sale.findUnique({
      where: { id: cursor },
      select: { id: true, soldAt: true, customerId: true },
    });
    if (!cursorSale) {
      throw new CustomerHistoryError("invalid", "Cursor inválido.");
    }
    // A cursor naming another customer's sale would otherwise become the seek
    // boundary while rows stayed filtered by this customer, silently truncating
    // the history instead of failing.
    if (cursorSale.customerId !== customerId) {
      throw new CustomerHistoryError("invalid", "Cursor não pertence a este cliente.");
    }
    boundary = { soldAt: cursorSale.soldAt, id: cursorSale.id };
  }

  const where: Prisma.SaleWhereInput = boundary
    ? {
        customerId,
        OR: [
          { soldAt: { lt: boundary.soldAt } },
          { soldAt: boundary.soldAt, id: { lt: boundary.id } },
        ],
      }
    : { customerId };

  const sales = await client.sale.findMany({
    where,
    orderBy: [{ soldAt: "desc" }, { id: "desc" }],
    // One extra row tells us whether another page exists without a second query.
    take: limit + 1,
    include: {
      items: {
        // productId alone is not a total order: (saleId, productId) is not
        // unique, and direct writes and legacy data do produce two rows of the
        // same product in one sale.
        orderBy: [{ productId: "asc" }, { id: "asc" }],
        include: { product: true },
      },
    },
  });

  const page = sales.slice(0, limit);
  const nextCursor = sales.length > limit ? (page.at(-1)?.id ?? null) : null;

  return { customer, sales: page, nextCursor };
}
