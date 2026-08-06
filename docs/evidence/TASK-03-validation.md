# TASK-03 — Customer Validation Evidence

```yaml
task: TASK-03
branch: feat/TASK-03-customer-model
baseline: 712aae5f193e61cea6508b01d165480f3abe8e74
mode: SUPERVISED_PILOT
status: REMOTE_REVIEW_PASS_AWAITING_MERGE
implementation_head: cd80bd6
reviewed_remote_head: 3bebde46ff5c19d4cea1acba173a1906d43bab2e
pr_number: 6
ci_run: 31116541370
ci_status: PASS
playwright: NOT_REQUIRED_NO_UI_CHANGE
next_eligible_task: PILOT_AUDIT
blocked_tasks:
  - TASK-04
```

## Diagnóstico e contrato

- A branch obrigatória existia local e remotamente e estava exatamente na baseline esperada.
- O SDD define que todo cliente possui nome e que telefone é único quando informado.
- Nenhum Product, Sale, Stock, alerta, autenticação ou fluxo de interface foi implementado.

## Implementação

- `Customer.id`: inteiro autoincremental e chave primária.
- `Customer.name`: `String` obrigatório.
- `Customer.phone`: `String? @unique`; PostgreSQL rejeita duplicatas informadas e permite múltiplos `NULL`.
- `createdAt`: `DateTime @default(now())`.
- `updatedAt`: `DateTime @updatedAt`.
- `DatabaseMarker` e sua migração inicial foram preservados.
- Migração nova: `prisma/migrations/20260806151419_add_customer/migration.sql`.
- Teste determinístico: `scripts/customer-model-check.mjs`, exposto por `npm test` e `npm run test:customer`.
- CI executa o teste de persistência após aplicar as migrações.

## Validação local

- `npm install --no-audit --no-fund` — PASS.
- `npm run db:generate` — PASS.
- `npm run db:validate` — PASS.
- `docker compose config` com porta isolada — PASS.
- PostgreSQL `16-alpine` iniciou saudável sem interromper containers externos.
- `npm run db:migrate` — PASS.
- `npm run db:health` — PASS.
- `npm test` — PASS; criação, persistência, campos obrigatórios, timestamps, unicidade e múltiplos `NULL` foram testados contra PostgreSQL real.
- Inspeção SQL — PASS; tabela `Customer`, índice `Customer_phone_key`, timestamps e nullability confirmados.
- Recriação limpa — PASS; as duas migrações foram aplicadas desde zero e o banco terminou sem dados de teste.
- `npm run lint` — PASS.
- `npm run typecheck` — PASS.
- `npm run build` — PASS.
- `git diff --check` — PASS.
- Scan de segredos — PASS.

## Revisão remota

- Branch publicada: `feat/TASK-03-customer-model`.
- Pull request: `#6`.
- HEAD técnico revisado: `3bebde46ff5c19d4cea1acba173a1906d43bab2e`.
- Revisão técnica independente: PASS.
- CI remoto `Validate`, run `31116541370`: PASS.
- O fechamento documental posterior deve receber novo CI antes do merge.

## Correção auditada

O primeiro `prisma migrate dev` gerou um bloco redundante relacionado à sequência de `DatabaseMarker`. O SQL foi revisado, apenas o bloco redundante foi removido da migração nova e a cadeia completa foi reaplicada em banco existente e em banco limpo.

## Warnings e decisão de Playwright

- O build emitiu o warning já conhecido de múltiplos lockfiles acima do projeto; não afetou o resultado.
- Playwright: `NOT_REQUIRED_NO_UI_CHANGE`; a task altera apenas Prisma, banco, testes, CI e documentação.
- TASK-04 permanece bloqueada até o merge da TASK-03 e a auditoria final do piloto.
