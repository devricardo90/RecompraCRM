
"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

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

type ProductForm = {
  name: string;
  unit: string;
  currentStock: string;
  minimumStock: string;
  consumptionDays: string;
};

const emptyForm: ProductForm = {
  name: "",
  unit: "",
  currentStock: "0",
  minimumStock: "0",
  consumptionDays: "1",
};

async function readError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

function isLowStock(product: Product) {
  return product.currentStock <= product.minimumStock;
}

export default function ProductWorkspace() {
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/products", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readError(response, "Não foi possível carregar os produtos."));
      }

      const payload = (await response.json()) as { products: Product[] };
      setProducts(payload.products);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os produtos.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProducts(), 0);
    return () => window.clearTimeout(timer);
  }, [loadProducts]);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    if (!normalizedQuery) return products;

    return products.filter((product) =>
      [product.name, product.unit].some((value) => value.toLocaleLowerCase("pt-BR").includes(normalizedQuery)),
    );
  }, [products, query]);

  const lowStockCount = products.filter(isLowStock).length;

  const openCreateForm = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setSuccessMessage(null);
    setIsFormOpen(true);
  };

  const openEditForm = (product: Product) => {
    setEditingId(product.id);
    setForm({
      name: product.name,
      unit: product.unit,
      currentStock: String(product.currentStock),
      minimumStock: String(product.minimumStock),
      consumptionDays: String(product.consumptionDays),
    });
    setFormError(null);
    setSuccessMessage(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    if (isSaving) return;
    setIsFormOpen(false);
    setFormError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    const values = [form.currentStock, form.minimumStock, form.consumptionDays].map(Number);
    if (!form.name.trim() || !form.unit.trim()) {
      setFormError("Informe o nome e a unidade do produto.");
      return;
    }
    if (!values.every(Number.isInteger) || values[0] < 0 || values[1] < 0 || values[2] < 1) {
      setFormError("Confira os números de estoque e duração.");
      return;
    }

    setIsSaving(true);

    try {
      const endpoint = editingId ? `/api/products/${editingId}` : "/api/products";
      const response = await fetch(endpoint, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          unit: form.unit,
          currentStock: values[0],
          minimumStock: values[1],
          consumptionDays: values[2],
        }),
      });

      if (!response.ok) {
        throw new Error(await readError(response, "Não foi possível salvar o produto."));
      }

      await loadProducts();
      setIsFormOpen(false);
      setSuccessMessage(editingId ? "Produto atualizado." : "Produto cadastrado.");
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o produto.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-8 sm:py-8">
        <header className="flex flex-col gap-5 border-b border-slate-200 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-700 text-lg font-bold text-white shadow-sm">R</div>
            <div>
              <p className="text-sm font-semibold tracking-tight text-slate-950">Recompra CRM</p>
              <p className="text-xs font-medium text-slate-500">Produtos no ritmo do seu negócio</p>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-2" aria-label="Navegação principal">
            <Link href="/" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-emerald-600 hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2">Clientes</Link>
            <button type="button" onClick={openCreateForm} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2">
              <span aria-hidden="true" className="text-lg leading-none">+</span>
              Novo produto
            </button>
          </nav>
        </header>

        <section className="py-8 sm:py-10">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">Produtos e estoque</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-5xl">Saiba o que está pronto para a próxima venda.</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">Cadastre seus produtos, acompanhe o estoque atual e veja rapidamente o que precisa de atenção.</p>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">Produtos cadastrados</p>
              <p className="mt-2 text-2xl font-bold text-slate-950">{products.length}</p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
              <p className="text-sm text-amber-800">Estoque baixo</p>
              <p className="mt-2 text-2xl font-bold text-amber-950">{lowStockCount}</p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm">
              <p className="text-sm text-emerald-800">Próximo passo</p>
              <p className="mt-2 text-sm font-semibold text-emerald-950">Registrar uma venda</p>
            </div>
          </div>
        </section>

        <section className="flex flex-1 flex-col rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="product-list-title">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="product-list-title" className="text-xl font-bold text-slate-950">Seu catálogo</h2>
              <p className="mt-1 text-sm text-slate-500">Acompanhe estoque e duração estimada de consumo.</p>
            </div>
            <label className="relative block w-full sm:max-w-xs">
              <span className="sr-only">Buscar produtos</span>
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">⌕</span>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome ou unidade" className="min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 pl-9 pr-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100" />
            </label>
          </div>

          {successMessage && <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800" role="status">{successMessage}</p>}

          {isLoading ? (
            <div className="mt-6 space-y-3" aria-label="Carregando produtos" role="status">
              {[1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-2xl bg-slate-100" />)}
            </div>
          ) : error ? (
            <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5" role="alert">
              <p className="font-semibold text-red-950">Não foi possível carregar seu catálogo.</p>
              <p className="mt-1 text-sm text-red-800">{error}</p>
              <button type="button" onClick={() => void loadProducts()} className="mt-4 min-h-10 rounded-lg border border-red-300 px-3 text-sm font-semibold text-red-900 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2">Tentar novamente</button>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="mt-6 flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 px-5 py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-2xl text-emerald-700" aria-hidden="true">◇</div>
              <h3 className="mt-4 text-lg font-bold text-slate-950">{query ? "Nenhum produto encontrado" : "Seu catálogo começa aqui"}</h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">{query ? "Tente outro nome ou unidade." : "Cadastre seu primeiro produto para acompanhar o estoque."}</p>
              {!query && <button type="button" onClick={openCreateForm} className="mt-5 min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2">Cadastrar primeiro produto</button>}
            </div>
          ) : (
            <div className="mt-6 space-y-3" aria-live="polite">
              {filteredProducts.map((product) => {
                const lowStock = isLowStock(product);
                return (
                  <article key={product.id} className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-4 transition hover:border-emerald-200 hover:shadow-sm sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-semibold text-slate-950">{product.name}</h3>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{product.unit}</span>
                        {lowStock && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">Estoque baixo</span>}
                      </div>
                      <p className="mt-2 text-sm text-slate-500">Consumo estimado: {product.consumptionDays} dias por unidade</p>
                    </div>
                    <div className="flex items-center justify-between gap-4 sm:justify-end">
                      <div className="text-left sm:text-right">
                        <p className={`text-lg font-bold ${lowStock ? "text-amber-900" : "text-slate-950"}`}>{product.currentStock} {product.unit}</p>
                        <p className="text-xs text-slate-500">mínimo {product.minimumStock}</p>
                      </div>
                      <button type="button" onClick={() => openEditForm(product)} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:border-emerald-600 hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2">Editar</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {isFormOpen && (
        <div className="fixed inset-0 z-10 flex items-end justify-center overflow-y-auto bg-slate-950/40 p-4 sm:items-center sm:p-6" role="presentation">
          <section className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-3xl bg-white p-5 shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:p-7" role="dialog" aria-modal="true" aria-labelledby="product-form-title">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">{editingId ? "Editar produto" : "Novo produto"}</p>
                <h2 id="product-form-title" className="mt-1 text-2xl font-bold text-slate-950">{editingId ? "Atualize os dados" : "Cadastre um produto"}</h2>
              </div>
              <button type="button" onClick={closeForm} aria-label="Fechar formulário" className="flex h-10 w-10 items-center justify-center rounded-full text-2xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600">×</button>
            </div>
            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="product-name" className="text-sm font-semibold text-slate-800">Nome do produto</label>
                <input id="product-name" name="name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} autoFocus placeholder="Ex.: Shampoo neutro" className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" />
              </div>
              <div>
                <label htmlFor="product-unit" className="text-sm font-semibold text-slate-800">Unidade</label>
                <input id="product-unit" name="unit" value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))} placeholder="Ex.: un, kg, L" className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="product-current-stock" className="text-sm font-semibold text-slate-800">Estoque atual</label>
                  <input id="product-current-stock" name="currentStock" type="number" min="0" step="1" value={form.currentStock} onChange={(event) => setForm((current) => ({ ...current, currentStock: event.target.value }))} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" />
                </div>
                <div>
                  <label htmlFor="product-minimum-stock" className="text-sm font-semibold text-slate-800">Estoque mínimo</label>
                  <input id="product-minimum-stock" name="minimumStock" type="number" min="0" step="1" value={form.minimumStock} onChange={(event) => setForm((current) => ({ ...current, minimumStock: event.target.value }))} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" />
                </div>
              </div>
              <div>
                <label htmlFor="product-consumption-days" className="text-sm font-semibold text-slate-800">Duração estimada (dias por unidade)</label>
                <input id="product-consumption-days" name="consumptionDays" type="number" min="1" step="1" value={form.consumptionDays} onChange={(event) => setForm((current) => ({ ...current, consumptionDays: event.target.value }))} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" />
              </div>
              {formError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-800" role="alert">{formError}</p>}
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={closeForm} disabled={isSaving} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={isSaving} className="min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60">{isSaving ? "Salvando…" : editingId ? "Salvar alterações" : "Cadastrar produto"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
