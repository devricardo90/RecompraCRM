import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-[var(--background)]">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center px-4 py-10 text-center sm:px-8">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-2xl text-amber-700"
          aria-hidden="true"
        >
          ◇
        </div>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
          Página não encontrada
        </h1>
        <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
          O endereço acessado não existe ou foi removido.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
        >
          Voltar para clientes
        </Link>
      </div>
    </main>
  );
}
