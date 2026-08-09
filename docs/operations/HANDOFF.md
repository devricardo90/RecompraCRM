# Recompra CRM — Handoff do Último Loop

```yaml
schema_version: "1.0"
run_id: RCRM-MVP01-RUN-001
loop_id: RCRM-TASK-03-P1-FIX-ATTEMPT-01
status: TASK_04_READY_TO_START
task: TASK-04
mode: CONTROLLED_AUTONOMOUS
previous_agent: ChatGPT
next_role: Autonomous Agent
baseline_head: 44ae41746869f5dcf439f8903ff4d6be254aab9a
atomic_implementation_head: 6f24ffc0b32ec69daa405e6977283cc9a27e7427
validation_harness_head: ffc2eabe0f2d0ce7c980bb7a94eab7e33e2a4255
last_green_validated_head: 44ae41746869f5dcf439f8903ff4d6be254aab9a
merge_task_03: b3d2f30ed9941c24b973c9addd7578e789d0730b
merge_pr_7_main: 44ae41746869f5dcf439f8903ff4d6be254aab9a
plan:
  - tornar a constraint de nome Customer segura para dados legados
  - preservar linhas legadas inválidas sem apagar ou inventar dados
  - rejeitar nomes sem conteúdo em novos INSERT/UPDATE
  - validar automaticamente a constraint quando não houver legado inválido
  - preservar o contrato de telefone opcional e único quando informado
  - validar a migração em PostgreSQL limpo e executar os gates locais
  - iniciar TASK-04 em branch isolada a partir da main verde
  - entregar interface de clientes sem antecipar entidades futuras
changes:
  - "Migração 20260806204721_enforce_customer_name usa NOT VALID e validação condicional."
  - "Harness scripts/customer-migration-compat-check.mjs cria bancos isolados e executa migrate deploy real."
  - "Teste Customer cobre nome omitido, vazio, espaços, tabs e quebras de linha."
  - "Telefone normal, duplicado e múltiplos NULL continuam cobertos."
  - "STATE, evidence, HANDOFF, PILOT-AUDIT e LESSONS atualizados."
validation: VERIFIED_GREEN_MAIN_CI
playwright_ephemeral: NOT_REQUIRED_NO_UI_CHANGE
review: PILOT_APPROVED
findings:
  - "P1 corrigido com NOT VALID e validação condicional, sem alterar dados legados."
  - "Harness limitado deterministicamente às migrations anteriores à migration alvo."
  - "Aprovação humana final do piloto concedida."
  - "PR #7 mergeado em main no commit 44ae41746869f5dcf439f8903ff4d6be254aab9a."
  - "Validate #26 / CI 31306424995 SUCCESS em main."
  - "Migrations, database health, migration compatibility, Customer persistence, lint, typecheck e build: PASS."
  - "Findings técnicos P1/P2 encerrados; nenhuma pendência técnica do piloto."
lessons_read:
  - LESSON-RCRM-0001
  - LESSON-RCRM-0002
  - LESSON-RCRM-0003
  - LESSON-RCRM-0004
  - LESSON-RCRM-0005
lessons_created:
  - LESSON-RCRM-0006
  - LESSON-RCRM-0007
evidence: docs/evidence/TASK-03-validation.md
pilot_evidence: docs/evidence/PILOT-AUDIT.md
ci_run: 31306424995
ci_status: SUCCESS
last_green_ci_run: 31306424995
previous_main_ci_run: 31117339641
previous_main_ci_status: INFRASTRUCTURE_FAILURE
pr_number: 7
last_completed_task: TASK-03
current_task: TASK-04
next_eligible_task: TASK-04
next_action: START_TASK_04
next_action_authorized: true
restart_command: git switch main && git pull --ff-only origin main && npm install
```
