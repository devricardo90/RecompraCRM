"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { formatBusinessDate } from "@/lib/format/businessDate";
import type { RepurchaseBucket, RepurchaseCounts } from "@/lib/sales/repurchaseForecast";

type RepurchaseItem = {
  saleItemId: number;
  bucket: RepurchaseBucket;
  expectedRepurchaseAt: string;
  quantity: number;
  sale: { id: number; soldAt: string };
  customer: { id: number; name: string; phone: string | null };
  product: { id: number; name: string; unit: string };
};

type RepurchasePayload = {
  generatedAt: string;
  counts: RepurchaseCounts;
  items: RepurchaseItem[];
};

const BUCKETS: { key: RepurchaseBucket; label: string; tone: string }[] = [
  { key: "overdue", label: "Vencidas", tone: "text-rose-800 bg-rose-100" },
  { key: "today", label: "Hoje", tone: "text-amber-900 bg-amber-100" },
  { key: "upcoming", label: "Próximos sete dias", tone: "text-emerald-800 bg-emerald-100" },
];

const LINK_CLASS =
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-emerald-600 hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2";

async function readError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

export default function RepurchaseWorkspace() {
  const [payload, setPayload] = useState<RepurchasePayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/repurchases", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readError(response, "Não foi possível carregar as recompras."));
      }
      setPayload((await response.json()) as RepurchasePayload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível carregar as recompras.");
      setPayload(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Deferred rather than called in the effect body, matching the inventory
  // dashboard: a synchronous setState here cascades renders.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // The server already decided every bucket from a single reference instant.
  // Re-deciding here would let a page rendered after business midnight regroup
  // items while the counts still described the previous day.
  const counts = payload?.counts ?? { overdue: 0, today: 0, upcoming: 0 };
  const total = counts.overdue + counts.today + counts.upcoming;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">Quem contatar para recompra</p>
          <h1 className="text-2xl font-semibold text-slate-900">Recompras a contatar</h1>
        </div>
        <nav className="flex flex-wrap items-center gap-2" aria-label="Navegação principal">
          <Link href="/" className={LINK_CLASS}>Clientes</Link>
          <Link href="/products" className={LINK_CLASS}>Produtos</Link>
          <Link href="/sales" className={LINK_CLASS}>Registrar venda</Link>
          <Link href="/inventory" className={LINK_CLASS}>Estoque</Link>
        </nav>
      </header>

      <section aria-label="Resumo" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {BUCKETS.map((bucket) => (
          <div key={bucket.key} className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-medium text-slate-600">{bucket.label}</p>
            <p className="text-2xl font-semibold text-slate-900">{counts[bucket.key]}</p>
          </div>
        ))}
      </section>

      {isLoading && (
        <p role="status" className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          Carregando recompras…
        </p>
      )}

      {error && !isLoading && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm text-rose-900">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex min-h-11 w-fit items-center justify-center rounded-xl bg-rose-700 px-4 text-sm font-semibold text-white transition hover:bg-rose-800 focus:outline-none focus:ring-2 focus:ring-rose-600 focus:ring-offset-2"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {!isLoading && !error && total === 0 && (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700">
          Nenhuma recompra vencida, para hoje ou para os próximos sete dias.
        </p>
      )}

      {!isLoading && !error && total > 0 && (
        <div className="flex flex-col gap-6">
          {BUCKETS.map((bucket) => {
            const items = (payload?.items ?? []).filter((item) => item.bucket === bucket.key);
            return (
              <section key={bucket.key} aria-label={bucket.label} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-900">{bucket.label}</h2>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${bucket.tone}`}>
                    {counts[bucket.key]}
                  </span>
                </div>

                {items.length === 0 ? (
                  <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                    Nada neste grupo.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {items.map((item) => (
                      <li key={item.saleItemId} className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-base font-semibold text-slate-900">{item.customer.name}</p>
                          <p className="text-sm text-slate-600">
                            Prevista: {formatBusinessDate(item.expectedRepurchaseAt)}
                          </p>
                        </div>
                        <p className="text-sm text-slate-700">
                          {item.product.name} · {item.quantity} {item.product.unit}
                        </p>
                        <p className="text-sm text-slate-600">
                          Telefone: {item.customer.phone ?? "—"} · Venda em {formatBusinessDate(item.sale.soldAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
