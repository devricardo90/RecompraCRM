const productContent = /[^\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/u;
export const POSTGRES_INTEGER_MAX = 2_147_483_647;

export class ProductInputError extends Error {}

export async function parseProductRequest(request: Request) {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ProductInputError("Informe um JSON válido.");
    }

    throw error;
  }
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || !productContent.test(value)) {
    throw new ProductInputError(`Informe ${label}.`);
  }

  return value.trim();
}

function integerValue(value: unknown, label: string, minimum: number) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > POSTGRES_INTEGER_MAX
  ) {
    throw new ProductInputError(
      `${label} deve ser um número inteiro entre ${minimum} e ${POSTGRES_INTEGER_MAX}.`,
    );
  }

  return value;
}

export function parseProductInput(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ProductInputError("Informe os dados do produto.");
  }

  const input = payload as Record<string, unknown>;
  const name = requiredText(input.name, "o nome do produto");
  const unit = requiredText(input.unit, "a unidade do produto");
  const currentStock = integerValue(input.currentStock, "O estoque atual", 0);
  const minimumStock = integerValue(input.minimumStock, "O estoque mínimo", 0);
  const consumptionDays = integerValue(input.consumptionDays, "A duração de consumo", 1);

  return { name, unit, currentStock, minimumStock, consumptionDays };
}
