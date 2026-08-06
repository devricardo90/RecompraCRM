# Recompra CRM — Handoff do Último Loop

```yaml
schema_version: "1.0"
run_id: RCRM-MVP01-RUN-001
loop_id: RCRM-TASK-03-ATTEMPT-01
status: AWAITING_MERGE_THEN_PILOT_AUDIT
task: TASK-03
previous_agent: ChatGPT
next_role: Human Pilot Auditor
baseline_head: 712aae5f193e61cea6508b01d165480f3abe8e74
implementation_head: cd80bd6
reviewed_remote_head: 3bebde46ff5c19d4cea1acba173a1906d43bab2e
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
validation: PASS
playwright_ephemeral: NOT_REQUIRED_NO_UI_CHANGE
review: APPROVED_INDEPENDENT
findings:
  - "A migração incremental continha uma alteração redundante da sequência do DatabaseMarker; o bloco foi removido da migração nova e a cadeia completa foi revalidada."
  - "PostgreSQL foi validado em porta isolada sem interromper containers externos."
  - "O warning conhecido de múltiplos lockfiles não afetou lint, typecheck ou build."
  - "PR #6 revisado tecnicamente no HEAD 3bebde46ff5c19d4cea1acba173a1906d43bab2e."
lessons_read:
  - LESSON-RCRM-0001
  - LESSON-RCRM-0002
  - LESSON-RCRM-0003
lessons_created:
  - LESSON-RCRM-0004
  - LESSON-RCRM-0005
evidence: docs/evidence/TASK-03-validation.md
ci_run: 31116541370
ci_status: PASS
pr_number: 6
pr_review: APPROVED_TECHNICAL
last_completed_task: TASK-02
current_task: TASK-03
next_eligible_task: PILOT_AUDIT
blocked_tasks:
  - TASK-04
next_action: Concluir CI do fechamento documental, fazer merge da TASK-03 e executar a auditoria humana do piloto; não iniciar TASK-04 antes da decisão da auditoria.
restart_command: git switch feat/TASK-03-customer-model && git pull
```
