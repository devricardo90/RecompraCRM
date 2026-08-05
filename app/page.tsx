const foundationChecks = [
  "Next.js App Router",
  "TypeScript estrito",
  "Tailwind CSS",
  "ESLint",
  "Rick Loop operacional",
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16 sm:px-10">
      <section className="rounded-3xl border border-emerald-950/10 bg-white p-7 shadow-sm sm:p-12">
        <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">
          MVP-01 · TASK-01
        </span>

        <div className="mt-6 max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Recompra CRM
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-950 sm:text-6xl">
            Clientes recorrentes sem depender da memória.
          </h1>
          <p className="mt-5 text-lg leading-8 text-slate-600">
            Fundação técnica preparada para evoluir o cadastro de clientes,
            produtos, vendas, estoque e alertas de recompra.
          </p>
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          {foundationChecks.map((check) => (
            <div
              key={check}
              className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3"
            >
              <span aria-hidden="true" className="text-emerald-700">
                ✓
              </span>
              <span className="font-medium text-slate-800">{check}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
