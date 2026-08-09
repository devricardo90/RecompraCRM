# TASK-04 — Customer Interface Evidence

```yaml
task: TASK-04
branch: feat/TASK-04-customer-interface
baseline: 2d7e8c4a2d03131b5c7512f2b114a7efefd9e2fb
baseline_ci: 31307415339
mode: CONTROLLED_AUTONOMOUS
status: FINAL_IMPLEMENTATION_VERIFIED_GREEN_AWAITING_REVIEW
technical_commit: d34591a0fcae06b03fb2ab52a9c8d4acd7202e89
pr: 8
ci_run: 31316500371
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

## Findings finais

- P2-1: validação explícita de Unicode White_Space, incluindo U+0085, para
  rejeitar nomes sem conteúdo com HTTP 400.
- P2-2: exibição de `updatedAt` removida da UI; date display deferred until
  the business timezone is canonically defined.
- P2-3: JSON inválido ou truncado em POST/PUT retorna HTTP 400; falhas de
  infraestrutura continuam retornando HTTP 503.
- P2-4: diálogo limitado por `100dvh` com scroll vertical e validado em
  landscape baixo.
- P2-5: HEAD e CI desta implementação foram reconciliados no roadmap.

## Fechamento

A TASK-04 está `FINAL_IMPLEMENTATION_VERIFIED_GREEN_AWAITING_REVIEW` no modo
`CONTROLLED_AUTONOMOUS`. O PR #8 está aberto e pronto para revisão, sem merge.
Nenhuma funcionalidade de Product, Sale ou Stock foi antecipada; TASK-05 não
foi iniciada.
