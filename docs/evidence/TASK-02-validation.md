# TASK-02 — Validation Evidence

Baseline: `42784f0c70c3cd7a4a4e58abd8aa4343cacfdff5`
Branch: `feat/TASK-02-database-prisma`

## Implementação

- Prisma e `@prisma/client`: `6.19.0`, ambos fixados.
- PostgreSQL: `16-alpine` via Docker Compose.
- Schema técnico: `DatabaseMarker`, mapeado para `_database_marker`; nenhum modelo de negócio foi criado.
- Migração: `prisma/migrations/20260806084446_init/migration.sql`.
- Lock de migrações: `prisma/migrations/migration_lock.toml`.
- Cliente reutilizável: `lib/prisma.ts`, com singleton para desenvolvimento.
- Health check: `scripts/db-healthcheck.mjs`, executa `SELECT 1` sem imprimir credenciais.
- CI: service container PostgreSQL local, `DATABASE_URL` de job e gates Prisma adicionados ao workflow existente.

## Gates executados

- `npm install --no-audit --no-fund` — PASS.
- `npm run db:generate` — PASS; Prisma Client 6.19.0 gerado.
- `npm run db:validate` — PASS.
- `docker compose config` — PASS.
- PostgreSQL iniciou saudável via `docker compose up -d --wait postgres`.
- `npm run db:migrate:dev -- --name init --skip-generate` em banco vazio — PASS; migração `20260806084446_init` criada e aplicada.
- `npm run db:migrate` — PASS; nenhuma migração pendente após a primeira aplicação.
- `npm run db:health` — PASS; conexão real e `SELECT 1` aprovados.
- Reprodutibilidade — PASS; o volume local foi removido com `docker compose down -v`, o PostgreSQL foi recriado e `npm run db:migrate` aplicou novamente a migração em banco limpo; `db:health` passou novamente.
- `npm run lint` — PASS.
- `npm run typecheck` — PASS.
- `npm run build` — PASS.
- `git diff --check` — PASS.
- Scan de segredos — PASS; nenhum padrão de chave/credencial real encontrado no projeto. Os valores `recompra_local_dev_only` e `recompra_ci_only` são credenciais explícitas de desenvolvimento/teste.
- Playwright — não executado; a task não altera fluxo de interface.

## Ambiente e warnings

- A porta 5432 estava ocupada pelo container externo `ecopickup-postgres`; a validação local usou `POSTGRES_PORT=55433`, sem interromper esse serviço. O default documentado continua 5432.
- O Next.js emitiu warning sobre o lockfile superior `C:\Users\ricardodev\pnpm-lock.yaml`; o build continuou verde e nenhuma configuração visual foi alterada.
- O registry reportou Prisma 7.9.1 disponível; a major não foi antecipada. Prisma 6.19.0 foi escolhida por compatibilidade com o runtime clássico e validada localmente.
- O primeiro download de engine foi afetado por cache/arquivo parcial do ambiente Windows; o `npm install` normal e o `prisma generate` finais passaram após a instalação ser concluída.

## Escopo e revisão

- Alterados somente infraestrutura de banco, scripts, documentação operacional, evidência, state/handoff/lessons e CI de validação.
- Nenhum Customer, Product, Sale ou funcionalidade futura foi implementado.
- Branch publicada: `feat/TASK-02-database-prisma`.
- Pull request: `#5`.
- HEAD revisado antes deste fechamento documental: `60af2a5f9043460124fae53df3059b1e0468d2e5`.
- Revisão técnica independente: aprovada.
- CI remoto: run `31112180901` — PASS.
- O novo push deste fechamento deverá gerar novo CI; TASK-02 permanece aberta até esse CI e o merge.
