# Recompra CRM — Handoff do Último Loop

```yaml
schema_version: "1.0"
run_id: RCRM-MVP01-RUN-001
loop_id: RCRM-TASK-03-P1-FIX-ATTEMPT-01
status: P1_HARNESS_READY_PENDING_CI
task: TASK-03-P1-FIX
previous_agent: ChatGPT
next_role: Human Reviewer
baseline_head: a3292835905d58a169aede27c1a9c1e1f9d905dc
implementation_head: local_p1_fix_commit
merge_task_03: b3d2f30ed9941c24b973c9addd7578e789d0730b
plan:
  - tornar a constraint de nome Customer segura para dados legados
  - preservar linhas legadas inválidas sem apagar ou inventar dados
  - rejeitar nomes sem conteúdo em novos INSERT/UPDATE
  - validar automaticamente a constraint quando não houver legado inválido
  - preservar o contrato de telefone opcional e único quando informado
  - validar a migração em PostgreSQL limpo e executar os gates locais
  - executar cenários A/B contra PostgreSQL real no GitHub Actions
  - aguardar PR/CI verdes antes de iniciar TASK-04
changes:
  - "Migração 20260806204721_enforce_customer_name usa NOT VALID e validação condicional."
  - "Harness scripts/customer-migration-compat-check.mjs cria bancos isolados e executa migrate deploy real."
  - "Teste Customer cobre nome omitido, vazio, espaços, tabs e quebras de linha."
  - "Telefone normal, duplicado e múltiplos NULL continuam cobertos."
  - "STATE, evidence, HANDOFF, PILOT-AUDIT e LESSONS atualizados."
validation: LOCAL_GATES_PASS_POSTGRES_DEFERRED_TO_CI
playwright_ephemeral: NOT_REQUIRED_NO_UI_CHANGE
review: P1_PENDING_CI_AND_HUMAN_REVIEW
findings:
  - "P1 corrigido com NOT VALID e validação condicional, sem alterar dados legados."
  - "Harness pronto; evidência autoritativa dos cenários A/B será o GitHub Actions."
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
ci_run: null
ci_status: PENDING_PUSH
previous_main_ci_run: 31117339641
previous_main_ci_status: INFRASTRUCTURE_FAILURE
pr_number: null
last_completed_task: TASK-03
current_task: TASK-03-P1-FIX
next_eligible_task: PILOT_AUDIT
blocked_tasks:
  - TASK-04
next_action: Publicar o harness no PR #7 e aguardar o CI A/B; não iniciar TASK-04.
restart_command: git switch fix/TASK-03-reject-blank-customer-name && npm install
```
