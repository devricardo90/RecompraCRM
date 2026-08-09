# TASK-05 — Product Model Evidence

```yaml
task: TASK-05
branch: feat/TASK-05-product-model
baseline: 8083428ad45b78eb18129ecd57a2abdc15455c61
baseline_ci: 31317857816
mode: CONTROLLED_AUTONOMOUS
status: VERIFIED_GREEN_AWAITING_CODEX_REVIEW
technical_commit: 5c23f6dfc69669d9adf8143d5a41672d9da15336
pr: 9
ci_run: 31318451893
ci_status: SUCCESS
next_task: TASK-06
```

## Contrato implementado

O SDD define que todo Product possui nome, unidade, estoque atual, estoque
mínimo e duração estimada de consumo. O modelo usa `name`, `unit`,
`currentStock`, `minimumStock` e `consumptionDays`, além dos timestamps
técnicos padrão. Não foram adicionados Product API, UI, Sale ou Stock
operacional.

Persistem as seguintes invariantes:

- nome e unidade não podem ser vazios ou somente whitespace Unicode;
- estoque atual e estoque mínimo não podem ser negativos;
- duração estimada deve ser positiva.

## Arquivos

- `prisma/schema.prisma` — modelo Product;
- `prisma/migrations/20260809090000_add_product/migration.sql` — migração
  versionada;
- `scripts/product-model-check.mjs` — teste determinístico de create/read/update/delete,
  timestamps e constraints;
- `package.json` e `.github/workflows/validate.yml` — script e gate Product;
- `README.md` — setup operacional.

## Validação local

- `npm install --no-audit --no-fund` — PASS;
- `npm run db:generate` — PASS;
- `npm run db:validate` — PASS com `DATABASE_URL` local configurada;
- `docker compose config` — PASS;
- `npm run lint` — PASS;
- `npm run typecheck` — PASS;
- `npm run build` — PASS; warning conhecido de múltiplos lockfiles;
- `node --check scripts/product-model-check.mjs` — PASS;
- `git diff --check` — PASS;
- scan de segredos — PASS;
- `npm test`, `npm run db:health`, `npm run db:migrate` e
  `npm run test:product` — BLOQUEADOS localmente por Docker/WSL indisponível e
  credenciais não correspondentes na porta PostgreSQL existente. Nenhum
  container externo foi interrompido.

## Validação remota

Validate #37 (`31318451893`) concluiu `SUCCESS` no commit técnico e executou
contra PostgreSQL real:

- Generate Prisma Client e validação do schema — PASS;
- cadeia completa de migrations e database health — PASS;
- migration compatibility — PASS;
- Customer persistence — PASS;
- Product persistence — PASS;
- Customer API integration — PASS;
- lint, typecheck e build — PASS.

## Interface e revisão

Playwright: `NOT_REQUIRED_NO_UI_CHANGE`.

O PR #9 está aberto e pronto para revisão. A revisão Codex foi solicitada por
comentário, mas ainda não foi publicada; a task permanece tecnicamente verde,
aguardando esse gate. TASK-06 não foi iniciada.
