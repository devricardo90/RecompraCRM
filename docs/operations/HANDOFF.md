# Recompra CRM — Handoff do Último Loop

```yaml
schema_version: "1.0"
run_id: RCRM-MVP01-RUN-002
loop_id: RCRM-TASK-04-CUSTOMER-INTERFACE-ATTEMPT-01
status: TASK_04_API_INTEGRATION_VERIFIED_PR_READY
task: TASK-04
mode: CONTROLLED_AUTONOMOUS
previous_agent: ChatGPT
next_role: Autonomous Agent
baseline_head: 2d7e8c4a2d03131b5c7512f2b114a7efefd9e2fb
atomic_implementation_head: 6f24ffc0b32ec69daa405e6977283cc9a27e7427
validation_harness_head: ffc2eabe0f2d0ce7c980bb7a94eab7e33e2a4255
last_green_validated_head: 2d7e8c4a2d03131b5c7512f2b114a7efefd9e2fb
merge_task_03: b3d2f30ed9941c24b973c9addd7578e789d0730b
merge_pr_7_main: 44ae41746869f5dcf439f8903ff4d6be254aab9a
plan:
  - tornar a constraint de nome Customer segura para dados legados
  - preservar linhas legadas inválidas sem apagar ou inventar dados
  - rejeitar nomes sem conteúdo em novos INSERT/UPDATE
  - validar automaticamente a constraint quando não houver legado inválido
  - preservar o contrato de telefone opcional e único quando informado
  - validar a migração em PostgreSQL limpo e executar os gates locais
  - validar a interface de clientes no CI com PostgreSQL real
  - manter o PR #8 aberto para integração
changes:
  - "Migração 20260806204721_enforce_customer_name usa NOT VALID e validação condicional."
  - "Harness scripts/customer-migration-compat-check.mjs cria bancos isolados e executa migrate deploy real."
  - "Teste Customer cobre nome omitido, vazio, espaços, tabs e quebras de linha."
  - "Telefone normal, duplicado e múltiplos NULL continuam cobertos."
  - "STATE, evidence, HANDOFF, PILOT-AUDIT e LESSONS atualizados."
  - "Interface Customer implementada com lista, cadastro, edição, busca e empty state."
  - "API Customer adicionada em GET/POST /api/customers e PUT /api/customers/:id."
validation: API_INTEGRATION_VERIFIED_GREEN_CI
playwright_ephemeral: PASS_DESKTOP_MOBILE_EPHEMERAL
review: TASK_04_API_INTEGRATION_VERIFIED_PR_8_READY
findings:
  - "P1 corrigido com NOT VALID e validação condicional, sem alterar dados legados."
  - "Harness limitado deterministicamente às migrations anteriores à migration alvo."
  - "Aprovação humana final do piloto concedida."
  - "PR #7 mergeado em main no commit 44ae41746869f5dcf439f8903ff4d6be254aab9a."
  - "Validate #26 / CI 31306424995 SUCCESS em main."
  - "Migrations, database health, migration compatibility, Customer persistence, lint, typecheck e build: PASS."
  - "TASK-04 technical commit: b3e87a062fb62ce5a97fbde0840db31851e9af28."
  - "Customer API integration harness: abed0ece0281e2e2182ce7f2fca3eb2d3f4c6132."
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
ci_run: 31313323944
ci_status: SUCCESS
last_green_ci_run: 31313323944
previous_main_ci_run: 31117339641
previous_main_ci_status: INFRASTRUCTURE_FAILURE
pr_number: 7
last_completed_task: TASK-03
current_task: TASK-04
next_eligible_task: TASK-05
technical_commit: b3e87a062fb62ce5a97fbde0840db31851e9af28
validation_head: abed0ece0281e2e2182ce7f2fca3eb2d3f4c6132
pr_8_status: OPEN_READY_FOR_REVIEW
local_validation_blocker: POSTGRESQL_UNAVAILABLE_DOCKER_WSL
next_action: REQUEST_CODEX_REVIEW
next_action_authorized: true
restart_command: git switch feat/TASK-04-customer-interface && npm install
```
