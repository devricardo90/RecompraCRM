# Recompra CRM — Handoff do Último Loop

```yaml
schema_version: "1.0"
run_id: RCRM-MVP01-RUN-001
loop_id: RCRM-TASK-03-P1-FIX-ATTEMPT-01
status: PILOT_READY_FOR_HUMAN_APPROVAL
task: PILOT_AUDIT
previous_agent: ChatGPT
next_role: Human Reviewer
baseline_head: a3292835905d58a169aede27c1a9c1e1f9d905dc
atomic_implementation_head: 6f24ffc0b32ec69daa405e6977283cc9a27e7427
validation_harness_head: ffc2eabe0f2d0ce7c980bb7a94eab7e33e2a4255
last_green_validated_head: a2b443cc117c5332e7cd00242ef4c26d3771aded
merge_task_03: b3d2f30ed9941c24b973c9addd7578e789d0730b
plan:
  - tornar a constraint de nome Customer segura para dados legados
  - preservar linhas legadas inválidas sem apagar ou inventar dados
  - rejeitar nomes sem conteúdo em novos INSERT/UPDATE
  - validar automaticamente a constraint quando não houver legado inválido
  - preservar o contrato de telefone opcional e único quando informado
  - validar a migração em PostgreSQL limpo e executar os gates locais
  - registrar a aprovação humana final do piloto
  - autorizar explicitamente TASK-04 somente após a aprovação humana
changes:
  - "Migração 20260806204721_enforce_customer_name usa NOT VALID e validação condicional."
  - "Harness scripts/customer-migration-compat-check.mjs cria bancos isolados e executa migrate deploy real."
  - "Teste Customer cobre nome omitido, vazio, espaços, tabs e quebras de linha."
  - "Telefone normal, duplicado e múltiplos NULL continuam cobertos."
  - "STATE, evidence, HANDOFF, PILOT-AUDIT e LESSONS atualizados."
validation: LOCAL_GATES_PASS_POSTGRES_DEFERRED_TO_CI
playwright_ephemeral: NOT_REQUIRED_NO_UI_CHANGE
review: TECHNICAL_FINDINGS_CLOSED_AWAITING_HUMAN_PILOT_APPROVAL
findings:
  - "P1 corrigido com NOT VALID e validação condicional, sem alterar dados legados."
  - "Harness limitado deterministicamente às migrations anteriores à migration alvo."
  - "CI 31304186437 SUCCESS validou a2b443cc117c5332e7cd00242ef4c26d3771aded."
  - "Cenários PostgreSQL A/B, migration compatibility e Customer persistence: PASS."
  - "Findings técnicos P1/P2 encerrados; falta aprovação humana final do piloto."
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
ci_run: 31304186437
ci_status: SUCCESS
last_green_ci_run: 31304186437
previous_main_ci_run: 31117339641
previous_main_ci_status: INFRASTRUCTURE_FAILURE
pr_number: 7
last_completed_task: TASK-03
current_task: PILOT_AUDIT
next_eligible_task: TASK-04
blocked_tasks:
  - TASK-04
next_action: Aguardar aprovação humana final do piloto; TASK-04 permanece bloqueada.
restart_command: git switch fix/TASK-03-reject-blank-customer-name && npm install
```
