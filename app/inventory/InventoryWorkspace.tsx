"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getStockAlerts, isLowStock } from "@/lib/products/stockAlerts";

type Product = {
  id: number;
  name: string;
  unit: string;
  currentStock: number;
  minimumStock: number;
  consumptionDays: number;
  createdAt: string;
  updatedAt: string;
};

async function readError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

export default function InventoryWorkspace() {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/products", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readError(response, "Não foi possível carregar os alertas de estoque."));
      }

      const payload = (await response.json()) as { products: Product[] };
      setProducts(payload.products);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Não foi possível carregar os alertas de estoque.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProducts(), 0);
    return () => window.clearTimeout(timer);
  }, [loadProducts]);

  const alerts = useMemo(() => getStockAlerts(products), [products]);

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
              <p className="text-xs font-medium text-slate-500">Estoque no ritmo do seu negócio</p>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-2" aria-label="Navegação principal">
            <Link href="/repurchases" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-emerald-600 hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2">Recompra</Link>
            <Link href="/" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-emerald-600 hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2">Clientes</Link>
            <Link href="/products" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-emerald-600 hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2">Produtos</Link>
            <Link href="/sales" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-emerald-600 hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2">Registrar venda</Link>
          </nav>
        </header>

        <section className="py-8 sm:py-10">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">Estoque</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-5xl">Alertas de estoque</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
              Veja quais produtos precisam de reposição com base no estoque atual persistido.
            </p>
          </div>
        </section>

        <section className="flex flex-1 flex-col rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="inventory-alerts-title">
          <div>
            <h2 id="inventory-alerts-title" className="text-xl font-bold text-slate-950">Produtos que precisam de atenção</h2>
            <p className="mt-1 text-sm text-slate-500">Critério: estoque atual {"<="} estoque mínimo.</p>
          </div>

          {isLoading ? (
            <div className="mt-6 space-y-3" aria-label="Carregando alertas de estoque" role="status" aria-live="polite">
              <div className="h-20 animate-pulse rounded-2xl bg-slate-100" />
              <div className="h-20 animate-pulse rounded-2xl bg-slate-100" />
            </div>
          ) : error ? (
            <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5" role="alert">
              <p className="font-semibold text-red-950">Não foi possível carregar os alertas.</p>
              <p className="mt-1 text-sm text-red-800">{error}</p>
              <button type="button" onClick={() => void loadProducts()} className="mt-4 inline-flex min-h-11 items-center rounded-lg border border-red-300 px-3 text-sm font-semibold text-red-900 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2">Tentar novamente</button>
            </div>
          ) : (
            <div className="mt-6" aria-live="polite">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4" data-testid="inventory-summary">
                <p className="text-sm font-semibold text-amber-900">{alerts.length} {alerts.length === 1 ? "produto" : "produtos"} em alerta</p>
                <p className="mt-1 text-sm text-amber-800">Estoque atual {"<="} estoque mínimo.</p>
              </div>
              {alerts.length === 0 ? (
                <div className="mt-4 flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 px-5 py-12 text-center" data-testid="inventory-empty-state">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-2xl text-emerald-700" aria-hidden="true">✓</div>
                  <h3 className="mt-4 text-lg font-bold text-slate-950">Nenhum produto precisa de reposição agora</h3>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">Todos os produtos estão acima do estoque mínimo.</p>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {alerts.map((product) => {
                    const lowStock = isLowStock(product);
                    return (
                      <article key={product.id} data-testid="stock-alert" className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-4 transition hover:border-emerald-200 hover:shadow-sm sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="break-words font-semibold text-slate-950">{product.name}</h3>
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{product.unit}</span>
                            {lowStock && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">Estoque baixo</span>}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-4 sm:justify-end">
                          <div className="text-left sm:text-right">
                            <p className="text-lg font-bold text-amber-900">{product.currentStock} {product.unit}</p>
                            <p className="text-xs text-slate-500">mínimo {product.minimumStock}</p>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
