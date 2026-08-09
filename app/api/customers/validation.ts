export type CustomerInput = {
  name: string;
  phone: string | null;
};

export class CustomerInputError extends Error {}

const customerNameContent = /[^\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/u;

export async function parseCustomerRequest(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new CustomerInputError("Informe um JSON válido.");
    }

    throw error;
  }
}

export function parseCustomerInput(payload: unknown): CustomerInput {
  if (!payload || typeof payload !== "object") {
    throw new CustomerInputError("Informe os dados do cliente.");
  }

  const data = payload as Record<string, unknown>;
  const rawName = typeof data.name === "string" ? data.name : "";
  const name = rawName.trim();
  const phoneValue = typeof data.phone === "string" ? data.phone.trim() : "";

  if (!name || !customerNameContent.test(rawName)) {
    throw new CustomerInputError("Informe o nome do cliente.");
  }

  return {
    name,
    phone: phoneValue || null,
  };
}
