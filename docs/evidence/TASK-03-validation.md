# TASK-03 — Customer Validation Evidence

```yaml
task: TASK-03
branch: fix/TASK-03-reject-blank-customer-name
baseline: a3292835905d58a169aede27c1a9c1e1f9d905dc
mode: SUPERVISED_PILOT
status: P1_FIX_IMPLEMENTED_LOCAL_PENDING_POSTGRES_VALIDATION
finding: P1_LEGACY_UNSAFE_CUSTOMER_NAME_CONSTRAINT
implementation_head: local_p1_fix_commit
merge_commit: b3d2f30ed9941c24b973c9addd7578e789d0730b
pr_number: null
ci_branch_run: 31116844373
ci_branch_status: PASS
ci_main_run: 31117339641
ci_main_status: INFRASTRUCTURE_FAILURE
p1_status: IMPLEMENTED_LOCAL_PENDING_POSTGRES_SCENARIOS_AND_CI
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

SQL final:

```sql
ALTER TABLE "Customer"
ADD CONSTRAINT "Customer_name_not_blank"
CHECK ("name" ~ '[^[:space:]]') NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "Customer"
    WHERE "name" !~ '[^[:space:]]'
  ) THEN
    ALTER TABLE "Customer"
    VALIDATE CONSTRAINT "Customer_name_not_blank";
  END IF;
END
$$;
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
- Cenário A — PENDENTE: Docker Desktop/WSL indisponível antes da execução.
- Cenário B — PENDENTE: Docker Desktop/WSL indisponível antes da execução.
- `npm run db:migrate` — PENDENTE; requer PostgreSQL real disponível.
- `npm run db:health` — BLOCKED; não foi possível alcançar o PostgreSQL local.
- `npm test` — BLOCKED por indisponibilidade do PostgreSQL, não por falha do teste.
- `npm run lint` — PASS.
- `npm run typecheck` — PASS.
- `npm run build` — PASS; warning conhecido de múltiplos lockfiles.
- `git diff --check` — será executado antes do commit.
- Scan de segredos — será executado antes do commit.

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
- O PR #7 continua aberto; a correção P1 ainda não foi publicada nem possui CI
  próprio.
- O veredito permanece `PILOT_BLOCKED` até os cenários PostgreSQL, PR/CI verdes
  e revisão humana.
- TASK-04 continua bloqueada e não foi iniciada.

## Playwright

`NOT_REQUIRED_NO_UI_CHANGE`: a correção altera apenas constraint de banco, teste
determinístico e documentação operacional.
