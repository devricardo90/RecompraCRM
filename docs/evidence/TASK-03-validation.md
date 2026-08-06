# TASK-03 — Customer Validation Evidence

```yaml
task: TASK-03
branch: feat/TASK-03-customer-model
baseline: 712aae5f193e61cea6508b01d165480f3abe8e74
mode: SUPERVISED_PILOT
status: IMPLEMENTED_AND_VALIDATED_PENDING_PILOT_AUDIT
implementation_head: cd80bd6
playwright: NOT_REQUIRED_NO_UI_CHANGE
next_eligible_task: PILOT_AUDIT
blocked_tasks:
  - TASK-04
```

## Diagnóstico e contrato

- A branch obrigatória existia local e remotamente e estava exatamente na baseline esperada.
- `main`, `origin/main` e `origin/feat/TASK-03-customer-model` apontaram para `712aae5f193e61cea6508b01d165480f3abe8e74` após `git fetch --all --prune`.
- O SDD define que todo cliente possui nome e que telefone é único quando informado.
- Nenhum Product, Sale, Stock, alerta, autenticação ou fluxo de interface foi implementado.

## Implementação

- `Customer.id`: inteiro autoincremental e chave primária.
- `Customer.name`: `String` obrigatório, sem campo especulativo de validação.
- `Customer.phone`: `String? @unique`; PostgreSQL rejeita duplicatas informadas e permite múltiplos `NULL`.
- `createdAt`: `DateTime @default(now())`.
- `updatedAt`: `DateTime @updatedAt`.
- `DatabaseMarker` e sua migração inicial foram preservados.
- Migração nova: `prisma/migrations/20260806151419_add_customer/migration.sql`.
- Teste determinístico: `scripts/customer-model-check.mjs`, exposto por `npm test` e `npm run test:customer`.
- CI passou a executar o teste de persistência após aplicar as migrações.

## Validação local

- `npm install --no-audit --no-fund` — PASS.
- `npm run db:generate` — PASS; Prisma Client `6.19.0` gerado.
- `npm run db:validate` — PASS.
- `docker compose config` com `POSTGRES_PORT=55433` — PASS.
- PostgreSQL `16-alpine` iniciou saudável na porta isolada `55433`; containers externos não foram interrompidos.
- `npm run db:migrate` após a migração inicial — PASS.
- `npm run db:health` — PASS; conexão real e `SELECT 1` aprovados.
- `npm test` — PASS; criação, persistência, campos obrigatórios, timestamps, unicidade e múltiplos `NULL` testados contra PostgreSQL real.
- Inspeção SQL — PASS; tabela `Customer`, `Customer_phone_key`, `createdAt`, `updatedAt` e nullability confirmados.
- Recriação limpa — PASS; volume `recompracrm_postgres_data` foi removido somente pelo Compose do projeto, PostgreSQL recriado e `npm run db:migrate` aplicou as duas migrações desde zero.
- Após a recriação limpa, `npm run db:health`, `npm test` e `prisma migrate status` passaram; o banco terminou sem dados de teste.
- `npm run lint` — PASS.
- `npm run typecheck` — PASS.
- `npm run build` — PASS.
- `git diff --check` — PASS.
- Scan de segredos no diff — PASS; nenhuma assinatura de token, chave privada ou credencial real encontrada. Os valores locais são exemplos explícitos de desenvolvimento.

## Correção auditada

O primeiro `prisma migrate dev` gerou um bloco redundante para recriar a sequência de `DatabaseMarker`, colidindo com a migração inicial. O SQL foi revisado, somente o bloco redundante foi removido da migração nova, a falha local foi resolvida como rollback e a migração foi reaplicada. A cadeia completa passou posteriormente em banco existente e em banco limpo.

## Warnings e decisão de Playwright

- O build emitiu o warning já conhecido de múltiplos lockfiles, com `C:\Users\ricardodev\pnpm-lock.yaml` acima do projeto; não afetou o resultado.
- Playwright: `NOT_REQUIRED_NO_UI_CHANGE`; a task altera apenas Prisma, banco, testes, CI e documentação, sem fluxo acessível ou interface visual.
- A revisão humana final do piloto ainda é necessária; TASK-04 permanece bloqueada.
