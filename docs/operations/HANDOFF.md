# Recompra CRM — Handoff do Último Loop

```yaml
schema_version: "1.0"
run_id: RCRM-MVP01-RUN-001
loop_id: RCRM-TASK-03-ATTEMPT-01
status: READY_FOR_PILOT_AUDIT
task: TASK-03
previous_agent: ChatGPT
next_role: Human Pilot Auditor
baseline_head: 712aae5f193e61cea6508b01d165480f3abe8e74
final_head: cd80bd6
plan:
  - confirmar no SDD que Customer exige nome e telefone único quando informado
  - adicionar somente o modelo Customer ao schema Prisma, preservando DatabaseMarker
  - criar migração versionada sem alterar a migração inicial
  - criar teste determinístico de persistência, obrigatoriedade, timestamps e unicidade
  - validar a cadeia completa em PostgreSQL limpo e registrar a evidência do piloto
changes:
  - "Customer criado com name obrigatório, phone opcional e único quando informado."
  - "Migração 20260806151419_add_customer criada e validada em banco existente e limpo."
  - "Teste determinístico de persistência integrado ao npm test e ao CI."
  - "README, evidence, STATE, HANDOFF, LESSONS e ROADMAP reconciliados."
files_changed:
  - .github/workflows/validate.yml
  - README.md
  - docs/evidence/TASK-03-validation.md
  - docs/operations/HANDOFF.md
  - docs/operations/LESSONS.md
  - docs/operations/STATE.md
  - docs/roadmap/ROADMAP.md
  - package.json
  - prisma/migrations/20260806151419_add_customer/migration.sql
  - prisma/schema.prisma
  - scripts/customer-model-check.mjs
commands:
  - npm install --no-audit --no-fund
  - npm run db:generate
  - npm run db:validate
  - docker compose config
  - docker compose up -d --wait postgres
  - npm run db:migrate
  - npm run db:health
  - npm test
  - prisma migrate status
  - npm run lint
  - npm run typecheck
  - npm run build
  - git diff --check
  - secret scan on added diff lines
validation: PASS
playwright_ephemeral: NOT_REQUIRED_NO_UI_CHANGE
review: PENDING_HUMAN_PILOT_AUDIT
findings:
  - "Primeira migração incremental gerou uma sequência redundante do DatabaseMarker; o SQL foi auditado, corrigido somente na migração nova e reaplicado."
  - "PostgreSQL 16-alpine foi validado na porta 55433 porque 5432 está ocupada por containers externos."
  - "O build emitiu warning de múltiplos lockfiles; compilação e typecheck passaram."
  - "TASK-03 não foi publicada, não recebeu PR e não foi feito merge, conforme o piloto supervisionado."
lessons_read:
  - LESSON-RCRM-0001
  - LESSON-RCRM-0002
  - LESSON-RCRM-0003
lessons_created:
  - LESSON-RCRM-0004
  - LESSON-RCRM-0005
evidence: docs/evidence/TASK-03-validation.md
ci_run: null
ci_status: NOT_REQUESTED_LOCAL_ONLY
previous_ci_run: 31112180901
pr_number: null
pr_review: NOT_REQUESTED_LOCAL_ONLY
last_completed_task: TASK-02
current_task: TASK-03
next_eligible_task: PILOT_AUDIT
blocked_tasks:
  - TASK-04
next_action: Auditoria humana final do piloto; não iniciar TASK-04.
restart_command: git switch feat/TASK-03-customer-model && npm install
```
