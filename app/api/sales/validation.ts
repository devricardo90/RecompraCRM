export const POSTGRES_INTEGER_MAX = 2_147_483_647;

export class SaleInputError extends Error {}

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
    if (typeof input.soldAt !== "string") {
      throw new SaleInputError("Informe uma data de venda válida.");
    }

    const parsed = new Date(input.soldAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new SaleInputError("Informe uma data de venda válida.");
    }

    soldAt = parsed;
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
