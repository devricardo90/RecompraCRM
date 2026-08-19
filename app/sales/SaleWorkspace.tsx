"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Customer = { id: number; name: string; phone: string | null };

type Product = {
  id: number;
  name: string;
  unit: string;
  currentStock: number;
  minimumStock: number;
  consumptionDays: number;
};

type SaleItemLine = { key: string; productId: string; quantity: string };

type RegisteredSale = {
  id: number;
  soldAt: string;
  customer: { id: number; name: string };
  items: Array<{
    id: number;
    quantity: number;
    expectedRepurchaseAt: string | null;
    product: { id: number; name: string; unit: string; currentStock: number };
  }>;
};

const POSTGRES_INTEGER_MAX = 2_147_483_647;

function newLine(): SaleItemLine {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    productId: "",
    quantity: "1",
  };
}

async function readError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function SaleWorkspace() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [lines, setLines] = useState<SaleItemLine[]>([newLine()]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<RegisteredSale | null>(null);

  const loadCatalog = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [customerResponse, productResponse] = await Promise.all([
        fetch("/api/customers", { cache: "no-store" }),
        fetch("/api/products", { cache: "no-store" }),
      ]);

      if (!customerResponse.ok) {
        throw new Error(await readError(customerResponse, "Não foi possível carregar os clientes."));
      }
      if (!productResponse.ok) {
        throw new Error(await readError(productResponse, "Não foi possível carregar os produtos."));
      }

      const customerPayload = (await customerResponse.json()) as { customers: Customer[] };
      const productPayload = (await productResponse.json()) as { products: Product[] };
      setCustomers(customerPayload.customers);
      setProducts(productPayload.products);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Não foi possível carregar os dados da venda.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCatalog(), 0);
    return () => window.clearTimeout(timer);
  }, [loadCatalog]);

  const productsById = useMemo(() => new Map(products.map((item) => [item.id, item])), [products]);

  const selectedTotals = useMemo(() => {
    const totals = new Map<number, number>();
    for (const line of lines) {
      const productId = Number(line.productId);
      const quantity = Number(line.quantity);
      if (!Number.isInteger(productId) || productId < 1) continue;
      if (!Number.isInteger(quantity) || quantity < 1) continue;
      totals.set(productId, (totals.get(productId) ?? 0) + quantity);
    }
    return totals;
  }, [lines]);

  const itemCount = lines.length;

  const updateLine = (key: string, patch: Partial<SaleItemLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
    setFormError(null);
  };

  const addLine = () => {
    setLines((current) => [...current, newLine()]);
    setFormError(null);
  };

  const removeLine = (key: string) => {
    setLines((current) => (current.length === 1 ? current : current.filter((line) => line.key !== key)));
    setFormError(null);
  };

  const resetForm = () => {
    setCustomerId("");
    setLines([newLine()]);
    setFormError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Guards a double-click and a repeated Enter: the second submit is dropped
    // before it can create a second sale.
    if (isSaving) return;

    setFormError(null);
    setConfirmation(null);

    const parsedCustomerId = Number(customerId);
    if (!Number.isInteger(parsedCustomerId) || parsedCustomerId < 1) {
      setFormError("Selecione o cliente da venda.");
      return;
    }

    const items: Array<{ productId: number; quantity: number }> = [];
    for (const line of lines) {
      const productId = Number(line.productId);
      if (!Number.isInteger(productId) || productId < 1) {
        setFormError("Selecione o produto de cada item.");
        return;
      }

      const quantity = Number(line.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > POSTGRES_INTEGER_MAX) {
        setFormError(`Informe uma quantidade inteira entre 1 e ${POSTGRES_INTEGER_MAX}.`);
        return;
      }

      items.push({ productId, quantity });
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: parsedCustomerId, items }),
      });

      if (!response.ok) {
        throw new Error(await readError(response, "Não foi possível registrar a venda."));
      }

      const payload = (await response.json()) as { sale: RegisteredSale };
      setConfirmation(payload.sale);
      resetForm();
      await loadCatalog();
    } catch (submitError) {
      setFormError(
        submitError instanceof Error ? submitError.message : "Não foi possível registrar a venda.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const canSubmit = !isLoading && !isSaving && customers.length > 0 && products.length > 0;

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-8 sm:py-8">
        <header className="flex flex-col gap-5 border-b border-slate-200 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-700 text-lg font-bold text-white shadow-sm">
              R
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight text-slate-950">Recompra CRM</p>
              <p className="text-xs font-medium text-slate-500">Registre a venda em poucos toques</p>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-2" aria-label="Navegação principal">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-emerald-600 hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
            >
              Clientes
            </Link>
            <Link
              href="/products"
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-emerald-600 hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
            >
              Produtos
            </Link>
          </nav>
        </header>

        <section className="py-8 sm:py-10">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
              Registro de venda
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-5xl">
              Registre a venda e já saiba quando voltar a oferecer.
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
              Escolha o cliente, some os produtos e confirme. O estoque e a previsão de recompra são
              atualizados na hora.
            </p>
          </div>
        </section>

        {confirmation && (
          <section
            className="mb-6 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm sm:p-6"
            role="status"
            aria-live="polite"
            data-testid="sale-confirmation"
          >
            <h2 className="text-lg font-bold text-emerald-950">Venda registrada</h2>
            <p className="mt-1 text-sm text-emerald-900">
              Cliente {confirmation.customer.name} · {confirmation.items.length}{" "}
              {confirmation.items.length === 1 ? "item" : "itens"}
            </p>
            <ul className="mt-4 space-y-2">
              {confirmation.items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-1 rounded-2xl bg-white/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="font-semibold text-emerald-950">
                    {item.quantity} × {item.product.name}
                  </span>
                  <span className="text-sm text-emerald-900">
                    Estoque agora: {item.product.currentStock} {item.product.unit} · Próxima compra:{" "}
                    <strong data-testid="forecast-value">{formatDate(item.expectedRepurchaseAt)}</strong>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section
          className="flex flex-1 flex-col rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
          aria-labelledby="sale-form-title"
        >
          <div>
            <h2 id="sale-form-title" className="text-xl font-bold text-slate-950">
              Nova venda
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Você pode adicionar quantos produtos quiser nesta venda.
            </p>
          </div>

          {isLoading ? (
            <div className="mt-6 space-y-3" aria-label="Carregando dados da venda" role="status">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-24 animate-pulse rounded-2xl bg-slate-100" />
              ))}
            </div>
          ) : error ? (
            <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5" role="alert">
              <p className="font-semibold text-red-950">Não foi possível preparar a venda.</p>
              <p className="mt-1 text-sm text-red-800">{error}</p>
              <button
                type="button"
                onClick={() => void loadCatalog()}
                className="mt-4 min-h-10 rounded-lg border border-red-300 px-3 text-sm font-semibold text-red-900 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
              >
                Tentar novamente
              </button>
            </div>
          ) : customers.length === 0 || products.length === 0 ? (
            <div className="mt-6 flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 px-5 py-12 text-center">
              <div
                className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-2xl text-emerald-700"
                aria-hidden="true"
              >
                ◇
              </div>
              <h3 className="mt-4 text-lg font-bold text-slate-950">Falta um passo antes de vender</h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
                {customers.length === 0
                  ? "Cadastre um cliente para registrar a primeira venda."
                  : "Cadastre um produto para registrar a primeira venda."}
              </p>
              <Link
                href={customers.length === 0 ? "/" : "/products"}
                className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
              >
                {customers.length === 0 ? "Cadastrar cliente" : "Cadastrar produto"}
              </Link>
            </div>
          ) : (
            <form className="mt-6 space-y-5" onSubmit={handleSubmit} noValidate>
              <div>
                <label htmlFor="sale-customer" className="text-sm font-semibold text-slate-800">
                  Cliente
                </label>
                <select
                  id="sale-customer"
                  name="customerId"
                  value={customerId}
                  onChange={(event) => {
                    setCustomerId(event.target.value);
                    setFormError(null);
                  }}
                  className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                >
                  <option value="">Selecione o cliente</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-800">
                    Produtos ({itemCount})
                  </h3>
                  <button
                    type="button"
                    onClick={addLine}
                    data-testid="add-item"
                    className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:border-emerald-600 hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
                  >
                    <span aria-hidden="true">+</span> Adicionar produto
                  </button>
                </div>

                {lines.map((line, index) => {
                  const product = productsById.get(Number(line.productId));
                  const requested = selectedTotals.get(Number(line.productId)) ?? 0;
                  const exceedsStock = product ? requested > product.currentStock : false;

                  return (
                    <div
                      key={line.key}
                      data-testid="sale-item-row"
                      className="rounded-2xl border border-slate-200 p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="flex-1">
                          <label
                            htmlFor={`sale-product-${line.key}`}
                            className="text-sm font-semibold text-slate-800"
                          >
                            Produto {index + 1}
                          </label>
                          <select
                            id={`sale-product-${line.key}`}
                            data-testid="item-product"
                            value={line.productId}
                            onChange={(event) => updateLine(line.key, { productId: event.target.value })}
                            className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                          >
                            <option value="">Selecione o produto</option>
                            {products.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name} · {option.currentStock} {option.unit}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="sm:w-32">
                          <label
                            htmlFor={`sale-quantity-${line.key}`}
                            className="text-sm font-semibold text-slate-800"
                          >
                            Quantidade
                          </label>
                          <input
                            id={`sale-quantity-${line.key}`}
                            data-testid="item-quantity"
                            type="number"
                            inputMode="numeric"
                            min="1"
                            max={POSTGRES_INTEGER_MAX}
                            step="1"
                            value={line.quantity}
                            onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                            className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLine(line.key)}
                          disabled={lines.length === 1}
                          data-testid="remove-item"
                          aria-label={`Remover produto ${index + 1}`}
                          className="min-h-12 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:border-red-400 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 sm:min-h-12"
                        >
                          Remover
                        </button>
                      </div>
                      {product && (
                        <p
                          className={`mt-2 text-xs ${exceedsStock ? "font-semibold text-amber-900" : "text-slate-500"}`}
                          data-testid="stock-hint"
                        >
                          {exceedsStock
                            ? `Estoque disponível: ${product.currentStock} ${product.unit}. A venda será recusada.`
                            : `Estoque disponível: ${product.currentStock} ${product.unit}`}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {formError && (
                <p
                  className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-800"
                  role="alert"
                  data-testid="sale-error"
                >
                  {formError}
                </p>
              )}

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={resetForm}
                  disabled={isSaving}
                  className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Limpar
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  data-testid="submit-sale"
                  className="min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60"
                >
                  {isSaving ? "Registrando…" : "Registrar venda"}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
