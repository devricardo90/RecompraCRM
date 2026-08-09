# Recompra CRM — Handoff do Último Loop

```yaml
schema_version: "1.0"
run_id: RCRM-MVP01-RUN-002
loop_id: RCRM-TASK-04-CUSTOMER-INTERFACE-ATTEMPT-01
status: TASK_05_IMPLEMENTATION_IN_PROGRESS
task: TASK-05
mode: CONTROLLED_AUTONOMOUS
previous_agent: ChatGPT
next_role: Autonomous Agent
baseline_head: 8083428ad45b78eb18129ecd57a2abdc15455c61
atomic_implementation_head: 6f24ffc0b32ec69daa405e6977283cc9a27e7427
validation_harness_head: ffc2eabe0f2d0ce7c980bb7a94eab7e33e2a4255
last_green_validated_head: 8083428ad45b78eb18129ecd57a2abdc15455c61
merge_task_03: b3d2f30ed9941c24b973c9addd7578e789d0730b
merge_pr_7_main: 44ae41746869f5dcf439f8903ff4d6be254aab9a
plan:
  - adicionar somente o modelo Product definido no SDD
  - persistir nome, unidade, estoque atual, estoque mínimo e duração estimada
  - preservar estoque não negativo e tipos coerentes para a previsão futura
  - criar migração versionada e teste determinístico contra PostgreSQL real
  - validar a cadeia completa de migrações e os gates do projeto
changes:
  - "Migração 20260806204721_enforce_customer_name usa NOT VALID e validação condicional."
  - "Harness scripts/customer-migration-compat-check.mjs cria bancos isolados e executa migrate deploy real."
  - "Teste Customer cobre nome omitido, vazio, espaços, tabs e quebras de linha."
  - "Telefone normal, duplicado e múltiplos NULL continuam cobertos."
  - "STATE, evidence, HANDOFF, PILOT-AUDIT e LESSONS atualizados."
  - "Interface Customer implementada com lista, cadastro, edição, busca e empty state."
  - "API Customer adicionada em GET/POST /api/customers e PUT /api/customers/:id."
validation: TASK_05_BASELINE_VERIFIED_GREEN
playwright_ephemeral: PASS_DESKTOP_MOBILE_EPHEMERAL
review: TASK_05_NOT_YET_REVIEWED
findings:
  - "P1 corrigido com NOT VALID e validação condicional, sem alterar dados legados."
  - "Harness limitado deterministicamente às migrations anteriores à migration alvo."
  - "Aprovação humana final do piloto concedida."
  - "PR #7 mergeado em main no commit 44ae41746869f5dcf439f8903ff4d6be254aab9a."
  - "Validate #26 / CI 31306424995 SUCCESS em main."
  - "Migrations, database health, migration compatibility, Customer persistence, lint, typecheck e build: PASS."
  - "TASK-04 technical commit: b3e87a062fb62ce5a97fbde0840db31851e9af28."
  - "Customer API integration harness: abed0ece0281e2e2182ce7f2fca3eb2d3f4c6132."
  - "Final reviewed implementation commit: d34591a0fcae06b03fb2ab52a9c8d4acd7202e89."
  - "P2-1 through P2-5 corrigidos; date display deferred até timezone canônico do negócio."
  - "PostgreSQL local indisponível; persistência real foi confirmada no CI."
lessons_read:
  - LESSON-RCRM-0001
  - LESSON-RCRM-0002
  - LESSON-RCRM-0003
  - LESSON-RCRM-0004
  - LESSON-RCRM-0005
  - LESSON-RCRM-0006
  - LESSON-RCRM-0007
lessons_created:
  - LESSON-RCRM-0006
  - LESSON-RCRM-0007
evidence: docs/evidence/TASK-04-validation.md
pilot_evidence: docs/evidence/PILOT-AUDIT.md
ci_run: 31317857816
ci_status: SUCCESS
last_green_ci_run: 31317857816
previous_main_ci_run: 31117339641
previous_main_ci_status: INFRASTRUCTURE_FAILURE
pr_number: 8
last_completed_task: TASK-04
current_task: TASK-05
next_eligible_task: TASK-05
technical_commit: d34591a0fcae06b03fb2ab52a9c8d4acd7202e89
validation_head: 8083428ad45b78eb18129ecd57a2abdc15455c61
pr_8_status: MERGED
merge_pr_8_main_head: 19754d8d69c7d8d156ebeff5f42ef64a7c401814
local_validation_blocker: POSTGRESQL_UNAVAILABLE_DOCKER_WSL
task_05_branch: feat/TASK-05-product-model
task_05_baseline: 8083428ad45b78eb18129ecd57a2abdc15455c61
next_action: IMPLEMENT_TASK_05
next_action_authorized: true
restart_command: git switch feat/TASK-05-product-model && npm install
```

TASK-04 foi mergeada pelo PR #8 em `main` no commit
`19754d8d69c7d8d156ebeff5f42ef64a7c401814`. O fechamento documental em
`8083428ad45b78eb18129ecd57a2abdc15455c61` foi validado pelo Validate #36
(`31317857816`). A branch `feat/TASK-05-product-model` foi criada a partir
dessa baseline; a implementação do modelo Product é a atividade corrente.
