export type CustomerInput = {
  name: string;
  phone: string | null;
};

export class CustomerInputError extends Error {}

export function parseCustomerInput(payload: unknown): CustomerInput {
  if (!payload || typeof payload !== "object") {
    throw new CustomerInputError("Informe os dados do cliente.");
  }

  const data = payload as Record<string, unknown>;
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const phoneValue = typeof data.phone === "string" ? data.phone.trim() : "";

  if (!name) {
    throw new CustomerInputError("Informe o nome do cliente.");
  }

  return {
    name,
    phone: phoneValue || null,
  };
}
