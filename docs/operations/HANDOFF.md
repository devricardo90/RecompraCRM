# Recompra CRM — Handoff do Último Loop

```yaml
schema_version: "1.0"
run_id: RCRM-MVP01-RUN-001
loop_id: RCRM-TASK-03-P1-FIX-ATTEMPT-01
status: P2_REVIEW_FIX_READY_PENDING_CI
task: TASK-03-P1-FIX
previous_agent: ChatGPT
next_role: Human Reviewer
baseline_head: a3292835905d58a169aede27c1a9c1e1f9d905dc
implementation_head: 1fdee1081895d0be6d5a7c59c2526c57aa2e3400
validation_harness_head: ffc2eabe0f2d0ce7c980bb7a94eab7e33e2a4255
last_green_validated_head: 859269b9dcb8697d4ac67cb7a6221831c5a29747
merge_task_03: b3d2f30ed9941c24b973c9addd7578e789d0730b
plan:
  - tornar a constraint de nome Customer segura para dados legados
  - preservar linhas legadas inválidas sem apagar ou inventar dados
  - rejeitar nomes sem conteúdo em novos INSERT/UPDATE
  - validar automaticamente a constraint quando não houver legado inválido
  - preservar o contrato de telefone opcional e único quando informado
  - validar a migração em PostgreSQL limpo e executar os gates locais
  - executar nova validação CI dos cenários A/B contra o HEAD atual
  - aguardar PR/CI verdes antes de iniciar TASK-04
changes:
  - "Migração 20260806204721_enforce_customer_name usa NOT VALID e validação condicional."
  - "Harness scripts/customer-migration-compat-check.mjs cria bancos isolados e executa migrate deploy real."
  - "Teste Customer cobre nome omitido, vazio, espaços, tabs e quebras de linha."
  - "Telefone normal, duplicado e múltiplos NULL continuam cobertos."
  - "STATE, evidence, HANDOFF, PILOT-AUDIT e LESSONS atualizados."
validation: LOCAL_GATES_PASS_POSTGRES_DEFERRED_TO_CI
playwright_ephemeral: NOT_REQUIRED_NO_UI_CHANGE
review: P2_FINDINGS_FIXED_PENDING_NEW_CI_AND_HUMAN_REVIEW
findings:
  - "P1 corrigido com NOT VALID e validação condicional, sem alterar dados legados."
  - "Harness limitado deterministicamente às migrations anteriores à migration alvo."
  - "CI verde anterior: 31272281693 para 859269b9dcb8697d4ac67cb7a6221831c5a29747."
  - "Nova validação CI é necessária para os commits atuais."
  - "PILOT_BLOCKED até CI verde e revisão humana."
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
ci_run: 31272281693
ci_status: NEW_CI_REQUIRED_AFTER_REVIEW_FIX
last_green_ci_run: 31272281693
previous_main_ci_run: 31117339641
previous_main_ci_status: INFRASTRUCTURE_FAILURE
pr_number: 7
last_completed_task: TASK-03
current_task: TASK-03-P1-FIX
next_eligible_task: PILOT_AUDIT
blocked_tasks:
  - TASK-04
next_action: Aguardar novo CI do PR #7 para o HEAD atual; não iniciar TASK-04.
restart_command: git switch fix/TASK-03-reject-blank-customer-name && npm install
```
