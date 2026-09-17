# TASK-14 — Hardening do MVP Evidence

## Scope and baseline

- Task: `TASK-14 — Hardening do MVP`
- Mode: `CONTROLLED_AUTONOMOUS`
- Loop: `RICK_LOOP_V1_4`
- Branch: `feat/TASK-14-hardening`
- Baseline: `ffdf8f9a994464e472bc92e4cb9b68e69bb44086` (`main`, spec PR #32 merged)
- Spec: `docs/specs/TASK-14.md`

This task adds no functionality, route, endpoint or schema change. It brings
the six existing screens to a uniform, mechanically-verified accessibility
and state floor.

## Baseline audit gaps closed

The spec's own baseline audit (four review rounds) named six real gaps.
Writing the deterministic guard surfaced three more the audit missed —
each caught because the guard checks the literal markup rather than
inspection:

| Gap | Where | Fix |
| --- | --- | --- |
| `notFound` branch had no `role` | `CustomerHistoryWorkspace.tsx` | added `role="status"` (AC3.2) |
| primary error branch had no `role="alert"` | `CustomerHistoryWorkspace.tsx` | added (AC3.1) |
| malformed id fell through to Next's default 404 | `/customers/[id]/history/abc\|0\|-1` | added `app/not-found.tsx` (AC6.3) |
| retry/action buttons and links at `min-h-10` (40px) | `CustomerWorkspace`, `ProductWorkspace`, `SaleWorkspace`, `CustomerHistoryWorkspace` | bumped to `min-h-11` (44px, AC9) |
| modal close (`×`) button at `h-10 w-10` (40px) | `CustomerWorkspace`, `ProductWorkspace` | bumped to `h-11 w-11` (AC9) |
| `Voltar para clientes` link had no focus ring | `CustomerHistoryWorkspace` (notFound branch) | added `focus:ring` (AC7-adjacent floor item) |
| modal `Cancelar`/submit buttons had no focus ring | `CustomerWorkspace`, `ProductWorkspace` | added `focus:ring` |
| `Limpar`/`Registrar venda` buttons had no focus ring | `SaleWorkspace` | added `focus:ring` |

All found by `scripts/ui-hardening-check.mjs` failing during development, not
by inspection — exactly the failure mode the spec's "Riscos conhecidos"
section warned about (keyword/count audits produce false negatives).

## `scripts/ui-hardening-check.mjs`

Deterministic, no-browser guard in the style of `scripts/task-12-source-check.mjs`.
Per screen (the six routes plus `app/not-found.tsx` and `app/layout.tsx`):

- exactly one `<main>` and one `<h1>`;
- `role="status"` on the loading branch;
- `role="alert"` on the *primary* error branch specifically, plus a retry
  control in that branch;
- for `/customers/[id]/history`: a `notFound` branch distinct from error,
  carrying `role="status"` and a navigation exit, no retry, no `role="alert"`;
- an empty-state branch that never carries `role="alert"`;
- every `<nav>` has `aria-label`;
- every `<button>`/`<Link>` has visible text or `aria-label` (checked by
  extracting the tag, stripping `aria-hidden` inner spans, and asserting
  remaining text);
- every `<input>`/`<select>` has a matching `htmlFor`;
- every interactive element (`button`/`Link`/`input`/`select`) has
  `focus:` styling and a touch target of at least 44px (`min-h-11`, or a
  resolved square `h-11 w-11`);
- no raw `toLocaleDateString`;
- no fixed-pixel-width container that could force horizontal scroll;
- `lang="pt-BR"` once, in `app/layout.tsx`;
- **completeness (AC14)**: every `page.tsx` under `app/` outside `app/api/`
  is enumerated by route and must be one of the six known screens — a
  future screen written directly in `page.tsx`, or delegating to a
  differently-named component, fails the guard instead of silently
  escaping the floor.

What it explicitly does not prove, per the spec: that a marker is actually
*rendered* at runtime, and that the body doesn't scroll horizontally at
320px. Both are the ephemeral Playwright pass's job.

Wired into `npm test` (`test:ui-hardening`) and into `validate.yml` as its
own step, ahead of lint/typecheck/build (AC15).

## Deterministic validation

Run locally against the Docker Postgres service (`npm run db:up`) — Docker
was not running at the start of this session and was started to run this
suite; CI runs the same gates against its own Postgres service independent
of local state.

| Gate | Result |
| --- | --- |
| `db:generate` / `db:validate` / `db:migrate` / `db:health` | PASS |
| `npm test` (12 suites, incl. `test:ui-hardening`) | PASS |
| `test:product-api` | PASS |
| `test:customer-api` | PASS |
| `test:repurchase-dashboard` | PASS |
| `test:repurchase-api` | PASS |
| `test:loop-controller` | PASS |
| `test:loop-v1.4` | PASS |
| `lint` | PASS |
| `typecheck` | PASS |
| `build` | PASS |

## Playwright — ephemeral

8 scenarios, retries `0`, PASS. Driven entirely by network mocking
(`page.route`), not by seeding or reading the local dev database, because
that database already held pre-existing rows (63 customers, 85 products, 78
sales) this run must not touch. The temporary spec, config, and all
`test-results`/trace/screenshot artifacts were removed after the run per
`docs/operations/PLAYWRIGHT-EPHEMERAL.md`; nothing Playwright-related is
committed.

Covered, one scenario per screen unless noted:

- `/`: carregando, erro (+ retry text), vazio, conteúdo; keyboard Tab
  sequence with a visible focus indicator at each stop; no horizontal
  scroll at 320/768/1280px.
- `/products`: carregando, erro, vazio, conteúdo; no horizontal scroll.
- `/sales`: carregando, erro, vazio de pré-requisito ("Falta um passo antes
  de vender"), conteúdo (form reachable, cliente + produto seeded); no
  horizontal scroll.
- `/inventory`: carregando, erro, vazio, conteúdo (`stock-alert` row); no
  horizontal scroll.
- `/repurchases`: carregando, erro, vazio, conteúdo (bucketed item); no
  horizontal scroll.
- `/customers/[id]/history`: carregando, erro (`role="alert"` on
  `history-error`), vazio, conteúdo (`history-sale`); no horizontal scroll.
- `/customers/[id]/history` — não encontrado (id válido, cliente
  inexistente): `history-not-found` visible with `role="status"`, a
  "Voltar para clientes" link, and zero `role="alert"` on the page.
- `/customers/999999999/history`, `/abc`, `/0`, `/-1`: id malformado hits
  `app/not-found.tsx` (`<h1>Página não encontrada</h1>`, pt-BR, link back);
  no horizontal scroll checked on each malformed-id page too.

A fixture bug surfaced during the first run: `getByRole('alert')` also
matched Next.js's own route-change announcer
(`#__next-route-announcer__`, `role="alert"` by framework default),
producing a strict-mode double-match on every error-branch assertion. Fixed
by excluding that id from the locator — an artifact of the test harness,
not of the application.

## Acceptance criteria disposition

AC1–AC16 are proved by `scripts/ui-hardening-check.mjs` (static structure)
together with the Playwright pass above (runtime rendering and the two
behaviors the guard cannot check: marker rendering and 320px overflow).
AC17 is the Playwright pass itself, covering every state enumerated in the
spec's "Estratégia de testes" section including both not-found paths.

## Known limitations carried forward

Unchanged from prior tasks: L1 (current product name, no snapshot), L2 (no
price), L3 (pre-rule midnight-UTC rows), L4 (fixed-duration forecast). This
task touches none of them; ARCH-02's date contract is not reopened.
