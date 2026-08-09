# TASK-04 — Customer Interface Evidence

```yaml
task: TASK-04
branch: feat/TASK-04-customer-interface
baseline: 2d7e8c4a2d03131b5c7512f2b114a7efefd9e2fb
baseline_ci: 31307415339
mode: CONTROLLED_AUTONOMOUS
status: IMPLEMENTED_PENDING_CI
technical_commit: b3e87a062fb62ce5a97fbde0840db31851e9af28
next_task: TASK-04
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

## Próximo gate

Publicar a branch e executar o Validate com PostgreSQL real antes de marcar
TASK-04 como `COMPLETED`. A task permanece corrente no modo
`CONTROLLED_AUTONOMOUS`.
