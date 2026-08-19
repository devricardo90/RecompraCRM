"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Customer = {
  id: number;
  name: string;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
};

type CustomerForm = {
  name: string;
  phone: string;
};

const emptyForm: CustomerForm = { name: "", phone: "" };

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

async function readError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

export default function CustomerWorkspace() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<CustomerForm>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadCustomers = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/customers", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await readError(response, "Não foi possível carregar os clientes."));
      }

      const payload = (await response.json()) as { customers: Customer[] };
      setCustomers(payload.customers);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os clientes.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCustomers();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadCustomers]);

  const filteredCustomers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");

    if (!normalizedQuery) {
      return customers;
    }

    return customers.filter((customer) =>
      [customer.name, customer.phone ?? ""].some((value) =>
        value.toLocaleLowerCase("pt-BR").includes(normalizedQuery),
      ),
    );
  }, [customers, query]);

  const openCreateForm = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setSuccessMessage(null);
    setIsFormOpen(true);
  };

  const openEditForm = (customer: Customer) => {
    setEditingId(customer.id);
    setForm({ name: customer.name, phone: customer.phone ?? "" });
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

    if (!form.name.trim()) {
      setFormError("Informe o nome do cliente.");
      return;
    }

    setIsSaving(true);

    try {
      const endpoint = editingId ? `/api/customers/${editingId}` : "/api/customers";
      const response = await fetch(endpoint, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!response.ok) {
        throw new Error(await readError(response, "Não foi possível salvar o cliente."));
      }

      await loadCustomers();
      setIsFormOpen(false);
      setSuccessMessage(editingId ? "Cliente atualizado." : "Cliente cadastrado.");
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o cliente.");
    } finally {
      setIsSaving(false);
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
              <p className="text-xs font-medium text-slate-500">Relacionamentos que voltam</p>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-2" aria-label="Navegação principal">
            <Link href="/products" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-emerald-600 hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2">Produtos</Link>
            <Link href="/sales" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:border-emerald-600 hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2">Registrar venda</Link>
            <button
              type="button"
              onClick={openCreateForm}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
            >
              <span aria-hidden="true" className="text-lg leading-none">+</span>
              Novo cliente
            </button>
          </nav>
        </header>

        <section className="py-8 sm:py-10">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">Clientes</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-5xl">
              Um bom relacionamento começa pelo nome.
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
              Encontre rapidamente quem já compra com você e mantenha cada contato pronto para a próxima recompra.
            </p>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">Clientes cadastrados</p>
              <p className="mt-2 text-2xl font-bold text-slate-950">{customers.length}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">Com telefone</p>
              <p className="mt-2 text-2xl font-bold text-slate-950">{customers.filter((customer) => customer.phone).length}</p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 shadow-sm">
              <p className="text-sm text-emerald-800">Próximo passo</p>
              <p className="mt-2 text-sm font-semibold text-emerald-950">Registrar a primeira venda</p>
            </div>
          </div>
        </section>

        <section className="flex flex-1 flex-col rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="customer-list-title">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="customer-list-title" className="text-xl font-bold text-slate-950">Sua base de clientes</h2>
              <p className="mt-1 text-sm text-slate-500">Nome e telefone ficam sempre a um toque de distância.</p>
            </div>
            <label className="relative block w-full sm:max-w-xs">
              <span className="sr-only">Buscar clientes</span>
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">⌕</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por nome ou telefone"
                className="min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 pl-9 pr-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-100"
              />
            </label>
          </div>

          {successMessage && <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800" role="status">{successMessage}</p>}

          {isLoading ? (
            <div className="mt-6 space-y-3" aria-label="Carregando clientes" role="status">
              {[1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-2xl bg-slate-100" />)}
            </div>
          ) : error ? (
            <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5" role="alert">
              <p className="font-semibold text-red-950">Não foi possível carregar sua base.</p>
              <p className="mt-1 text-sm text-red-800">{error}</p>
              <button type="button" onClick={() => void loadCustomers()} className="mt-4 min-h-10 rounded-lg border border-red-300 px-3 text-sm font-semibold text-red-900 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2">Tentar novamente</button>
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div className="mt-6 flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 px-5 py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-2xl text-emerald-700" aria-hidden="true">♡</div>
              <h3 className="mt-4 text-lg font-bold text-slate-950">{query ? "Nenhum cliente encontrado" : "Sua base começa aqui"}</h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">{query ? "Tente outro nome ou telefone." : "Cadastre seu primeiro cliente para acompanhar cada relacionamento de perto."}</p>
              {!query && <button type="button" onClick={openCreateForm} className="mt-5 min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2">Cadastrar primeiro cliente</button>}
            </div>
          ) : (
            <div className="mt-6 space-y-3" aria-live="polite">
              {filteredCustomers.map((customer) => (
                <article key={customer.id} className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-4 transition hover:border-emerald-200 hover:shadow-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-800">{getInitials(customer.name)}</div>
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-slate-950">{customer.name}</h3>
                      <p className="mt-1 truncate text-sm text-slate-500">{customer.phone ?? "Telefone não informado"}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 sm:justify-end">
                    <button type="button" onClick={() => openEditForm(customer)} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition hover:border-emerald-600 hover:text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2">Editar</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {isFormOpen && (
        <div className="fixed inset-0 z-10 flex items-end justify-center overflow-y-auto bg-slate-950/40 p-4 sm:items-center sm:p-6" role="presentation">
          <section className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-3xl bg-white p-5 shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:p-7" role="dialog" aria-modal="true" aria-labelledby="customer-form-title">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-emerald-700">{editingId ? "Editar cadastro" : "Novo cadastro"}</p>
                <h2 id="customer-form-title" className="mt-1 text-2xl font-bold text-slate-950">{editingId ? "Atualize os dados" : "Cadastre um cliente"}</h2>
              </div>
              <button type="button" onClick={closeForm} aria-label="Fechar formulário" className="flex h-10 w-10 items-center justify-center rounded-full text-2xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-600">×</button>
            </div>
            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="customer-name" className="text-sm font-semibold text-slate-800">Nome completo</label>
                <input id="customer-name" name="name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} autoFocus placeholder="Ex.: Ana Souza" className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" />
              </div>
              <div>
                <label htmlFor="customer-phone" className="text-sm font-semibold text-slate-800">Telefone <span className="font-normal text-slate-400">(opcional)</span></label>
                <input id="customer-phone" name="phone" type="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="Ex.: (11) 99999-9999" className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" />
              </div>
              {formError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-800" role="alert">{formError}</p>}
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={closeForm} disabled={isSaving} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Cancelar</button>
                <button type="submit" disabled={isSaving} className="min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60">{isSaving ? "Salvando…" : editingId ? "Salvar alterações" : "Cadastrar cliente"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
