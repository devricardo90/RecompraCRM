# TASK-03 — Customer Validation Evidence

```yaml
task: TASK-03
branch: fix/TASK-03-reject-blank-customer-name
baseline: a3292835905d58a169aede27c1a9c1e1f9d905dc
mode: SUPERVISED_PILOT
status: P2_FIX_IMPLEMENTED_LOCAL_PENDING_PR_AND_CI
finding: P2_BLANK_CUSTOMER_NAME
implementation_head: 7cb1255c1249b88e00b75c9c5cdfa73d0973a8ee
merge_commit: b3d2f30ed9941c24b973c9addd7578e789d0730b
pr_number: null
ci_branch_run: 31116844373
ci_branch_status: PASS
ci_main_run: 31117339641
ci_main_status: INFRASTRUCTURE_FAILURE
p2_ci_status: PENDING_NOT_PUSHED
playwright: NOT_REQUIRED_NO_UI_CHANGE
next_eligible_task: PILOT_AUDIT
blocked_tasks:
  - TASK-04
```

## Finding P2

O contrato exige nome real. A constraint anterior rejeitava `NULL`, mas
aceitava `""`, espaços, tabs e quebras de linha sem conteúdo.

Correção mínima: a migração
`prisma/migrations/20260806204721_enforce_customer_name/migration.sql` adiciona
`Customer_name_not_blank` com `CHECK ("name" ~ '[^[:space:]]')`. A validação
ocorre no PostgreSQL e vale para qualquer caminho de persistência, sem novos
campos, dependências, Product, Sale, Stock ou UI.

## Testes determinísticos

`scripts/customer-model-check.mjs` agora prova:

- nome normal aceito e persistido;
- nome omitido rejeitado;
- string vazia rejeitada;
- somente espaços rejeitado;
- somente tabs rejeitado;
- somente quebras de linha/whitespace rejeitadas;
- telefone opcional funcionando;
- telefone informado duplicado rejeitado;
- múltiplos telefones `NULL` permitidos;
- timestamps persistidos.

## Validação local

- `npm run db:generate` — PASS; Prisma Client 6.19.0.
- `npm run db:validate` — PASS.
- `docker compose config` com `POSTGRES_PORT=55433` — PASS.
- PostgreSQL `16-alpine` iniciou saudável sem interromper containers externos.
- Volume exclusivo do projeto foi recriado desde banco vazio.
- `npm run db:migrate` — PASS; aplicou as três migrações, incluindo a nova constraint.
- `npm run db:health` — PASS.
- `npm test` — PASS.
- Inspeção SQL — PASS; constraint `Customer_name_not_blank` confirmada.
- `npm run lint` — PASS.
- `npm run typecheck` — PASS.
- `npm run build` — PASS.
- `git diff --check` — PASS.
- Scan de segredos — PASS.

## Revisão remota e estado do piloto

- TASK-03 continua mergeada em `main` no commit `b3d2f30`.
- O CI verde da implementação original na branch, run `31116844373`, permanece evidência técnica aprovada.
- O run da `main`, `31117339641`, permanece `INFRASTRUCTURE_FAILURE`; as duas tentativas não executaram gates do projeto.
- A correção P2 ainda não foi publicada, não possui PR nem CI próprio.
- O veredito permanece `PILOT_BLOCKED` até PR/CI verdes para a correção e revisão humana.
- TASK-04 continua bloqueada e não foi iniciada.

## Playwright

`NOT_REQUIRED_NO_UI_CHANGE`: a correção altera apenas constraint de banco, teste
determinístico e documentação operacional.
