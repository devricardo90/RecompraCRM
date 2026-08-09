# TASK-03 — Customer Validation Evidence

```yaml
task: TASK-03
branch: fix/TASK-03-reject-blank-customer-name
baseline: a3292835905d58a169aede27c1a9c1e1f9d905dc
mode: SUPERVISED_PILOT
status: ATOMIC_REPLACEMENT_IMPLEMENTED_PENDING_CI
finding: P1_LEGACY_UNSAFE_CUSTOMER_NAME_CONSTRAINT
implementation_head: ce516d44935c22db332bb226d2b84fd64739f308
validation_harness_head: ffc2eabe0f2d0ce7c980bb7a94eab7e33e2a4255
last_green_validated_head: ce516d44935c22db332bb226d2b84fd64739f308
merge_commit: b3d2f30ed9941c24b973c9addd7578e789d0730b
pr_number: 7
ci_branch_run: 31116844373
ci_branch_status: PASS
ci_main_run: 31117339641
ci_main_status: INFRASTRUCTURE_FAILURE
p1_status: HARNESS_VALIDATED_ON_PRIOR_HEAD
compatibility_harness: scripts/customer-migration-compat-check.mjs
compatibility_ci_status: LAST_GREEN_FOR_CE516D4_NEW_CI_REQUIRED_AFTER_ATOMIC_FIX
last_green_ci_run: 31278203432
playwright: NOT_REQUIRED_NO_UI_CHANGE
next_eligible_task: PILOT_AUDIT
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
dos gates de qualidade. O run verde `31278203432` validou o HEAD anterior
`ce516d44935c22db332bb226d2b84fd64739f308`, que contém a implementação
Unicode/U+0085; os commits atuais exigem nova
validação CI. Como o Docker/WSL local estava indisponível, a evidência
autoritativa dos cenários A/B continua sendo o GitHub Actions.

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
- `npm test` — NÃO EXECUTADO nesta validação local.
- `npm run lint` — PASS.
- `npm run typecheck` — PASS.
- `npm run build` — PASS; warning conhecido de múltiplos lockfiles.
- `git diff --check` — PASS.
- Scan de segredos — PASS.

### Cenários PostgreSQL obrigatórios

- Cenário A — ainda não executado: banco limpo, constraint validada e nomes
  inválidos rejeitados aguardam a recuperação do Docker.
- Cenário B — ainda não executado: linha legada inválida, migration bem-sucedida,
  linha preservada, novos inválidos rejeitados e `convalidated = false` aguardam
  a recuperação do Docker.
- Bloqueador operacional: Docker Desktop falhou ao inicializar o WSL com
  `DockerDesktop/Wsl/ExecError` e `0xc00000fd`; não há PostgreSQL local instalado.

## Revisão remota e estado do piloto

- TASK-03 continua mergeada em `main` no commit `b3d2f30`.
- O CI verde da implementação original na branch, run `31116844373`, permanece evidência técnica aprovada.
- O run da `main`, `31117339641`, permanece `INFRASTRUCTURE_FAILURE`; as duas tentativas não executaram gates do projeto.
- O PR #7 continua aberto; o harness está publicado no próprio PR #7.
- O CI verde `31278203432` valida o HEAD anterior
  `ce516d44935c22db332bb226d2b84fd64739f308`, que contém a implementação
  Unicode/U+0085; uma nova validação é necessária para os commits atuais.
- O veredito permanece `PILOT_BLOCKED` até o harness executar os cenários A/B,
  o CI ficar verde e a revisão humana ocorrer.
- TASK-04 continua bloqueada e não foi iniciada.

## Playwright

`NOT_REQUIRED_NO_UI_CHANGE`: a correção altera apenas constraint de banco, teste
determinístico e documentação operacional.
