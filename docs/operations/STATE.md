# Recompra CRM — Rick Loop State

```yaml
schema_version: "1.0"
state_version: 12
project: RecompraCRM
roadmap: MVP-01
global_status: RUNNING
mode: SUPERVISED_PILOT
completed_tasks:
  - TASK-01
  - TASK-02
  - TASK-03
last_completed_task: TASK-03
current_task: TASK-03-P1-FIX
current_task_status: implemented_local_pending_postgres_validation
next_eligible_task: PILOT_AUDIT
attempt: 1
max_attempts: 3
branch: fix/TASK-03-reject-blank-customer-name
baseline_head: a3292835905d58a169aede27c1a9c1e1f9d905dc
current_head: local_p1_fix_commit
implementation_head: local_p1_fix_commit
merge_task_02: 712aae5f193e61cea6508b01d165480f3abe8e74
merge_task_03: b3d2f30ed9941c24b973c9addd7578e789d0730b
p1_finding: P1_LEGACY_UNSAFE_CUSTOMER_NAME_CONSTRAINT
p1_status: IMPLEMENTED_LOCAL_PENDING_POSTGRES_SCENARIOS_AND_CI
p2_finding: P2_BLANK_CUSTOMER_NAME
p2_status: IMPLEMENTED_LOCAL
working_tree: clean_after_local_commit
baseline_status: VERIFIED_GREEN
validation_status: PARTIAL_LOCAL_DOCKER_BLOCKED
review_status: P1_PENDING_POSTGRES_PR_AND_CI
ci_run: null
ci_status: PENDING_NOT_PUSHED
previous_main_ci_run: 31117339641
previous_main_ci_status: INFRASTRUCTURE_FAILURE
pr_number: null
clean_main_ci_required: true
blockers:
  - P1_POSTGRES_SCENARIOS_REQUIRED
  - P1_FIX_PR_AND_CI_REQUIRED
  - CLEAN_MAIN_CI_REQUIRED
  - HUMAN_PILOT_AUDIT_REQUIRED
blocked_tasks:
  - TASK-04
lessons_validated:
  - LESSON-RCRM-0001
  - LESSON-RCRM-0002
  - LESSON-RCRM-0003
  - LESSON-RCRM-0004
  - LESSON-RCRM-0005
  - LESSON-RCRM-0006
  - LESSON-RCRM-0007
next_action: VALIDATE_POSTGRES_AND_REQUEST_P1_REVIEW
next_action_authorized: false
updated_at: "2026-08-07T00:00:00+02:00"
updated_by: ChatGPT
```

TASK-01, TASK-02 e TASK-03 permanecem concluídas e integradas; TASK-03 foi
mergeada em `b3d2f30`. O finding P1 de migration insegura para Customers legados
foi corrigido localmente com `NOT VALID` e validação condicional, sem alterar
dados. Os cenários PostgreSQL A/B ainda aguardam recuperação do Docker Desktop.
TASK-04 continua bloqueada, `next_eligible_task` permanece `PILOT_AUDIT` e o
modo segue `SUPERVISED_PILOT`.
