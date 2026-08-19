export const POSTGRES_INTEGER_MAX = 2_147_483_647;

export class SaleInputError extends Error {
  constructor(message: string) {
    super(message);
    // Named like the other sale errors so logs and tests can tell them apart
    // instead of seeing a bare "Error".
    this.name = "SaleInputError";
  }
}

export async function parseSaleRequest(request: Request) {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new SaleInputError("Informe um JSON válido.");
    }

    throw error;
  }
}

function identifier(value: unknown, label: string) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > POSTGRES_INTEGER_MAX
  ) {
    throw new SaleInputError(`Informe ${label}.`);
  }

  return value;
}

function quantity(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > POSTGRES_INTEGER_MAX
  ) {
    throw new SaleInputError(
      `A quantidade deve ser um número inteiro entre 1 e ${POSTGRES_INTEGER_MAX}.`,
    );
  }

  return value;
}

/**
 * JavaScript silently normalizes an impossible-but-parseable date: `2026-02-30`
 * becomes March 2. Checking only `getTime()` would therefore accept it and
 * record the sale -- and every forecast derived from it -- under a date the
 * caller never sent. So the calendar components are validated explicitly.
 */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function parseSoldAt(value: unknown) {
  if (typeof value !== "string") {
    throw new SaleInputError("Informe uma data de venda válida.");
  }

  const match = ISO_DATE.exec(value.trim());
  if (!match) {
    throw new SaleInputError("Informe uma data de venda válida no formato AAAA-MM-DD.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Round-trip the calendar date: if the components survive unchanged, the day
  // actually exists in that month.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new SaleInputError("Informe uma data de venda que exista no calendário.");
  }

  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) {
    throw new SaleInputError("Informe uma data de venda válida.");
  }

  return parsed;
}

export function parseSaleInput(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new SaleInputError("Informe os dados da venda.");
  }

  const input = payload as Record<string, unknown>;
  const customerId = identifier(input.customerId, "o cliente da venda");

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new SaleInputError("Adicione ao menos um produto à venda.");
  }

  const items = input.items.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new SaleInputError("Informe os dados de cada item da venda.");
    }

    const item = raw as Record<string, unknown>;
    return {
      productId: identifier(item.productId, "o produto do item"),
      quantity: quantity(item.quantity),
    };
  });

  // expectedRepurchaseAt is derived in the database. Accepting it here would
  // invite callers to believe it is theirs to set, so it is rejected outright
  // rather than silently ignored.
  for (const item of input.items as Record<string, unknown>[]) {
    if (item && typeof item === "object" && "expectedRepurchaseAt" in item) {
      throw new SaleInputError(
        "A previsão de recompra é calculada pelo sistema e não pode ser enviada.",
      );
    }
  }

  let soldAt = new Date();
  if (input.soldAt !== undefined) {
    soldAt = parseSoldAt(input.soldAt);
  }

  let notes: string | null = null;
  if (input.notes !== undefined && input.notes !== null) {
    if (typeof input.notes !== "string") {
      throw new SaleInputError("Informe uma observação válida.");
    }

    const trimmed = input.notes.trim();
    notes = trimmed.length > 0 ? trimmed : null;
  }

  return { customerId, items, soldAt, notes, status: "CONFIRMED" as const };
}
