# TASK-04 — Customer Interface Evidence

```yaml
task: TASK-04
branch: feat/TASK-04-customer-interface
baseline: 2d7e8c4a2d03131b5c7512f2b114a7efefd9e2fb
baseline_ci: 31307415339
mode: CONTROLLED_AUTONOMOUS
status: API_INTEGRATION_VERIFIED_GREEN
technical_commit: abed0ece0281e2e2182ce7f2fca3eb2d3f4c6132
pr: 8
ci_run: 31313323944
ci_status: SUCCESS
next_task: TASK-05
```

## Escopo implementado

- lista de clientes integrada ao modelo `Customer` existente;
- cadastro com nome obrigatório e telefone opcional;
- edição de nome e telefone;
- busca por nome ou telefone;
- empty state com CTA para o primeiro cadastro;
- loading state, error state com retry e mensagens de validação;
- layout mobile-first com estados acessíveis e sem antecipar Product, Sale ou Stock.

API adicionada:

- `GET /api/customers`;
- `POST /api/customers`;
- `PUT /api/customers/:id`.

## Validação local

- `npm install --no-audit --no-fund` — PASS.
- `npm run db:generate` — PASS; Prisma Client 6.19.0.
- `npm run db:validate` — PASS.
- `docker compose config` — PASS.
- `npm run lint` — PASS.
- `npm run typecheck` — PASS.
- `npm run build` — PASS; warning conhecido de múltiplos lockfiles.
- `git diff --check` — PASS.
- Scan de segredos — PASS.
- `npm test` — BLOQUEADO localmente: PostgreSQL indisponível no Docker/WSL.
- `npm run db:health` — BLOQUEADO localmente pela mesma indisponibilidade.
- `npm run test:customer-api` — BLOQUEADO localmente pela mesma indisponibilidade; o
  harness iniciou o Next e alcançou as rotas, que responderam 503 sem banco.

## Validação remota

Validate #31 (`31313323944`) concluiu `SUCCESS` no HEAD
`abed0ece0281e2e2182ce7f2fca3eb2d3f4c6132`. O job executou com PostgreSQL
real e aprovou migrations, database health, migration compatibility, Customer
persistence, Customer API integration, lint, typecheck e build. O novo step
exercitou as rotas reais `GET /api/customers`, `POST /api/customers` e
`PUT /api/customers/:id`.

## Playwright efêmero

PASS em desktop `1440x900` e mobile `390x844`:

- lista renderizada;
- busca por telefone;
- edição de cliente;
- empty state;
- cadastro pelo CTA;
- validação de nome obrigatório;
- ausência de overflow horizontal;
- console sem erros no cenário de API transitória.

O smoke de UI usou respostas em memória somente no Playwright efêmero; a
persistência real da API será confirmada pelo CI com PostgreSQL real. Nenhum
teste ou artefato Playwright foi salvo no repositório.

## Fechamento

A TASK-04 está `API_INTEGRATION_VERIFIED_GREEN` no modo
`CONTROLLED_AUTONOMOUS`. O PR #8 está aberto e pronto para revisão, sem merge.
Nenhuma funcionalidade de Product, Sale ou Stock foi antecipada; TASK-05 não
foi iniciada.
