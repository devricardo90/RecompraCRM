"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { formatBusinessDate } from "@/lib/format/businessDate";

type HistoryProduct = { id: number; name: string; unit: string };

type HistoryItem = {
  id: number;
  quantity: number;
  expectedRepurchaseAt: string | null;
  product: HistoryProduct;
};

type HistorySale = {
  id: number;
  soldAt: string;
  notes: string | null;
  items: HistoryItem[];
};

type HistoryCustomer = { id: number; name: string; phone: string | null };

async function readError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

export default function CustomerHistoryWorkspace({ customerId }: { customerId: number }) {
  const [customer, setCustomer] = useState<HistoryCustomer | null>(null);
  const [sales, setSales] = useState<HistorySale[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept apart from `error`: a failed "carregar mais" must not replace the
  // history already on screen with the first-page error panel.
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const loadFirstPage = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setLoadMoreError(null);
    setNotFound(false);

    try {
      const response = await fetch(`/api/customers/${customerId}/sales`, { cache: "no-store" });
      if (response.status === 404) {
        setNotFound(true);
        return;
      }
      if (!response.ok) {
        throw new Error(await readError(response, "Não foi possível carregar o histórico."));
      }

      const payload = (await response.json()) as {
        customer: HistoryCustomer;
        sales: HistorySale[];
        nextCursor: number | null;
      };
      setCustomer(payload.customer);
      setSales(payload.sales);
      setNextCursor(payload.nextCursor);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Não foi possível carregar o histórico.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadFirstPage(), 0);
    return () => window.clearTimeout(timer);
  }, [loadFirstPage]);

  const loadMore = async () => {
    if (nextCursor === null || isLoadingMore) return;
    setIsLoadingMore(true);
    setLoadMoreError(null);

    try {
      const response = await fetch(
        `/api/customers/${customerId}/sales?cursor=${nextCursor}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(await readError(response, "Não foi possível carregar mais vendas."));
      }

      const payload = (await response.json()) as {
        sales: HistorySale[];
        nextCursor: number | null;
      };
      setSales((current) => [...current, ...payload.sales]);
      setNextCursor(payload.nextCursor);
    } catch (loadError) {
      setLoadMoreError(
        loadError instanceof Error ? loadError.message : "Não foi possível carregar mais vendas.",
      );
    } finally {
      setIsLoadingMore(false);
    }
  };

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
              <p className="text-xs font-medium text-slate-500">Histórico do cliente</p>
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
              href="/sales"
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-emerald-600 hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
            >
              Registrar venda
            </Link>
          </nav>
        </header>

        <section className="py-8 sm:py-10">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Histórico de compras
          </p>
          <h1
            className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-5xl"
            data-testid="history-title"
          >
            {customer ? customer.name : "Histórico do cliente"}
          </h1>
          {customer?.phone && <p className="mt-2 text-base text-slate-600">{customer.phone}</p>}
        </section>

        <section
          className="flex flex-1 flex-col rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
          aria-labelledby="history-list-title"
        >
          <h2 id="history-list-title" className="text-xl font-bold text-slate-950">
            Compras registradas
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Da mais recente para a mais antiga, com a próxima compra prevista de cada item.
          </p>

          {isLoading ? (
            <div className="mt-6 space-y-3" aria-label="Carregando histórico" role="status">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-32 animate-pulse rounded-2xl bg-slate-100" />
              ))}
            </div>
          ) : notFound ? (
            <div
              className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5"
              data-testid="history-not-found"
            >
              <p className="font-semibold text-amber-950">Cliente não encontrado.</p>
              <p className="mt-1 text-sm text-amber-900">
                Esse cliente pode ter sido removido ou o endereço está incorreto.
              </p>
              <Link
                href="/"
                className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-amber-300 px-3 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
              >
                Voltar para clientes
              </Link>
            </div>
          ) : error ? (
            <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5" data-testid="history-error">
              <p className="font-semibold text-red-950">Não foi possível carregar o histórico.</p>
              <p className="mt-1 text-sm text-red-800">{error}</p>
              <button
                type="button"
                onClick={() => void loadFirstPage()}
                className="mt-4 min-h-10 rounded-lg border border-red-300 px-3 text-sm font-semibold text-red-900 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
              >
                Tentar novamente
              </button>
            </div>
          ) : sales.length === 0 ? (
            <div
              className="mt-6 flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 px-5 py-12 text-center"
              data-testid="history-empty"
            >
              <div
                className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-2xl text-emerald-700"
                aria-hidden="true"
              >
                ◇
              </div>
              <h3 className="mt-4 text-lg font-bold text-slate-950">Nenhuma compra ainda</h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
                Quando você registrar a primeira venda para este cliente, ela aparece aqui com a
                previsão de recompra.
              </p>
              <Link
                href="/sales"
                className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
              >
                Registrar venda
              </Link>
            </div>
          ) : (
            <>
              <ol className="mt-6 space-y-3" data-testid="history-list">
                {sales.map((sale) => (
                  <li
                    key={sale.id}
                    data-testid="history-sale"
                    data-sale-id={sale.id}
                    className="rounded-2xl border border-slate-200 p-4 transition hover:border-emerald-200 hover:shadow-sm"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-semibold text-slate-950" data-testid="sale-date">
                        {formatBusinessDate(sale.soldAt)}
                      </p>
                      <p className="text-sm text-slate-500">
                        {sale.items.length} {sale.items.length === 1 ? "item" : "itens"}
                      </p>
                    </div>
                    {sale.notes && <p className="mt-2 text-sm text-slate-600">{sale.notes}</p>}
                    <ul className="mt-3 space-y-2">
                      {sale.items.map((item) => (
                        <li
                          key={item.id}
                          data-testid="history-item"
                          className="flex flex-col gap-1 rounded-xl bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <span className="font-medium text-slate-900" data-testid="item-label">
                            {item.quantity} {item.product.unit} · {item.product.name}
                          </span>
                          <span className="text-sm text-slate-600">
                            Próxima compra:{" "}
                            <strong data-testid="item-forecast">
                              {formatBusinessDate(item.expectedRepurchaseAt)}
                            </strong>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>

              {loadMoreError && (
                <p
                  className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-800"
                  role="alert"
                  data-testid="history-load-more-error"
                >
                  {loadMoreError}
                </p>
              )}

              {nextCursor !== null && (
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={isLoadingMore}
                  data-testid="history-load-more"
                  className="mt-5 min-h-11 self-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-emerald-600 hover:text-emerald-800 disabled:cursor-wait disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
                >
                  {isLoadingMore ? "Carregando…" : "Carregar mais"}
                </button>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
