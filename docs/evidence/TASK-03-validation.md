# TASK-03 — Customer Validation Evidence

```yaml
task: TASK-03
branch: fix/TASK-03-reject-blank-customer-name
baseline: a3292835905d58a169aede27c1a9c1e1f9d905dc
mode: SUPERVISED_PILOT
status: PILOT_READY_FOR_HUMAN_APPROVAL
finding: P1_LEGACY_UNSAFE_CUSTOMER_NAME_CONSTRAINT
atomic_implementation_head: 6f24ffc0b32ec69daa405e6977283cc9a27e7427
validation_harness_head: ffc2eabe0f2d0ce7c980bb7a94eab7e33e2a4255
last_green_validated_head: a2b443cc117c5332e7cd00242ef4c26d3771aded
merge_commit: b3d2f30ed9941c24b973c9addd7578e789d0730b
pr_number: 7
ci_branch_run: 31116844373
ci_branch_status: PASS
ci_main_run: 31117339641
ci_main_status: INFRASTRUCTURE_FAILURE
ci_run: 31304186437
ci_status: SUCCESS
p1_status: TECHNICALLY_CLOSED_CI_PASS
compatibility_harness: scripts/customer-migration-compat-check.mjs
compatibility_ci_status: PASS
last_green_ci_run: 31304186437
playwright: NOT_REQUIRED_NO_UI_CHANGE
next_eligible_task: TASK-04
blocked_tasks:
  - TASK-04
```

## Finding P1

O finding P1 identificado no PR #7 era que a migration adicionava imediatamente
uma `CHECK` validada. Em banco existente, qualquer Customer legado com nome
vazio ou somente whitespace faria o deploy falhar.

Correção: a migration adiciona `Customer_name_not_blank` como `NOT VALID`,
mantendo linhas legadas intactas e aplicando a regra a novos `INSERT` e
`UPDATE`. Um bloco `DO` consulta linhas inválidas e executa
`VALIDATE CONSTRAINT` automaticamente somente quando nenhuma existir. Enquanto
houver legado inválido, a constraint permanece `NOT VALID` e a remediation deve
ser feita com dados reais aprovados antes da validação definitiva.

## Harness de compatibilidade

`npm run test:migration-compat` cria dois bancos PostgreSQL isolados, executa
`prisma migrate deploy` com a cadeia real e remove os bancos ao final. No
cenário legado, uma cópia temporária contém somente as migrations anteriores;
depois a migration `20260806204721_enforce_customer_name` real é aplicada.
O harness confirma a preservação da linha inválida, `convalidated = false`,
enforcement em novos registros e validação completa no banco limpo.

O workflow `Validate` executa esse harness depois de migrations/health e antes
dos gates de qualidade. O run `31304186437` concluiu `SUCCESS` e validou o
HEAD `a2b443cc117c5332e7cd00242ef4c26d3771aded`, incluindo a implementação
atômica `6f24ffc0b32ec69daa405e6977283cc9a27e7427`. Migration compatibility,
cenários PostgreSQL A/B e Customer persistence foram `PASS`. Como o Docker/WSL
local estava indisponível, essa é a evidência autoritativa do PostgreSQL.

SQL final da migration Unicode/U+0085:

```sql
BEGIN;

ALTER TABLE "Customer" DROP CONSTRAINT IF EXISTS "Customer_name_not_blank";

ALTER TABLE "Customer"
ADD CONSTRAINT "Customer_name_not_blank"
CHECK ("name" ~ E'[^ \\t\\n\\r\\x0B\\x0C\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]')
NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "Customer"
    WHERE "name" !~ E'[^ \\t\\n\\r\\x0B\\x0C\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]'
  ) THEN
    ALTER TABLE "Customer"
    VALIDATE CONSTRAINT "Customer_name_not_blank";
  END IF;
END
$$;

COMMIT;
```

## Finding P2 — preservado

O contrato exige nome real. A constraint anterior rejeitava `NULL`, mas
aceitava `""`, espaços, tabs e quebras de linha sem conteúdo.

Correção mínima anterior: a migração
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
- `npm run test:migration-compat` — NÃO EXECUTADO localmente; requer PostgreSQL
  real e será a evidência autoritativa do CI.
- Cenário A — NÃO EXECUTADO localmente: Docker Desktop/WSL indisponível.
- Cenário B — NÃO EXECUTADO localmente: Docker Desktop/WSL indisponível.
- `npm run db:migrate` — NÃO EXECUTADO nesta validação local.
- `npm run db:health` — NÃO EXECUTADO nesta validação local.
- `npm test` — PASS no CI `31304186437`; não executado localmente por falta de PostgreSQL.
- `npm run lint` — PASS.
- `npm run typecheck` — PASS.
- `npm run build` — PASS; warning conhecido de múltiplos lockfiles.
- `git diff --check` — PASS.
- Scan de segredos — PASS.

### Cenários PostgreSQL obrigatórios

- Cenário A — PASS no CI `31304186437`: banco limpo, constraint validada e nomes
  vazios/whitespace rejeitados.
- Cenário B — PASS no CI `31304186437`: linha legada preservada, migration
  bem-sucedida, novos inválidos rejeitados e `convalidated = false` quando
  aplicável.
- Migration compatibility — PASS no CI `31304186437`.
- Customer persistence — PASS no CI `31304186437`.
- Docker/WSL permanece indisponível localmente, sem bloquear a validação remota.

## Revisão remota e estado do piloto

- TASK-03 continua mergeada em `main` no commit `b3d2f30`.
- O CI verde da implementação original na branch, run `31116844373`, permanece evidência técnica aprovada.
- O run da `main`, `31117339641`, permanece `INFRASTRUCTURE_FAILURE`; as duas tentativas não executaram gates do projeto.
- O PR #7 continua aberto; o harness está publicado no próprio PR #7.
- O CI `31304186437` concluiu `SUCCESS` para o HEAD
  `a2b443cc117c5332e7cd00242ef4c26d3771aded`.
- Os findings técnicos P1/P2 estão encerrados; o piloto está
  `PILOT_READY_FOR_HUMAN_APPROVAL`.
- TASK-04 continua bloqueada exclusivamente pela aprovação humana final e não
  foi iniciada.

## Playwright

`NOT_REQUIRED_NO_UI_CHANGE`: a correção altera apenas constraint de banco, teste
determinístico e documentação operacional.
