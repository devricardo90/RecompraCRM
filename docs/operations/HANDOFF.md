# Recompra CRM — Handoff do Último Loop

```yaml
schema_version: "1.0"
run_id: RCRM-MVP01-RUN-001
loop_id: RCRM-TASK-03-P2-FIX-ATTEMPT-01
status: P2_FIX_READY_FOR_REVIEW
task: TASK-03-P2-FIX
previous_agent: ChatGPT
next_role: Human Reviewer
baseline_head: a3292835905d58a169aede27c1a9c1e1f9d905dc
implementation_head: 7cb1255c1249b88e00b75c9c5cdfa73d0973a8ee
merge_task_03: b3d2f30ed9941c24b973c9addd7578e789d0730b
plan:
  - rejeitar nomes Customer sem qualquer caractere não whitespace
  - preservar o contrato de telefone opcional e único quando informado
  - validar a migração em PostgreSQL limpo e executar os gates locais
  - aguardar PR/CI verdes antes de fechar o finding P2 ou iniciar TASK-04
changes:
  - "Migração 20260806204721_enforce_customer_name adiciona Customer_name_not_blank."
  - "Teste Customer cobre nome omitido, vazio, espaços, tabs e quebras de linha."
  - "Telefone normal, duplicado e múltiplos NULL continuam cobertos."
  - "STATE, evidence, HANDOFF, PILOT-AUDIT e LESSONS atualizados."
validation: PASS_LOCAL
playwright_ephemeral: NOT_REQUIRED_NO_UI_CHANGE
review: P2_PENDING_PR_AND_CI
findings:
  - "P2 corrigido com constraint persistente, sem alteração de Product, Sale, Stock ou UI."
  - "Recriação limpa aplicou as três migrações e o teste Customer passou."
  - "PILOT_BLOCKED até PR/CI verdes para a correção."
lessons_read:
  - LESSON-RCRM-0001
  - LESSON-RCRM-0002
  - LESSON-RCRM-0003
  - LESSON-RCRM-0004
  - LESSON-RCRM-0005
lessons_created:
  - LESSON-RCRM-0006
evidence: docs/evidence/TASK-03-validation.md
pilot_evidence: docs/evidence/PILOT-AUDIT.md
ci_run: null
ci_status: PENDING_NOT_PUSHED
previous_main_ci_run: 31117339641
previous_main_ci_status: INFRASTRUCTURE_FAILURE
pr_number: null
last_completed_task: TASK-03
current_task: TASK-03-P2-FIX
next_eligible_task: PILOT_AUDIT
blocked_tasks:
  - TASK-04
next_action: Criar commit local, solicitar revisão/PR e aguardar CI verde; não iniciar TASK-04.
restart_command: git switch fix/TASK-03-reject-blank-customer-name && npm install
```
