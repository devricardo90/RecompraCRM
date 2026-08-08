# Recompra CRM — Rick Loop State

```yaml
schema_version: "1.0"
state_version: 14
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
current_task_status: harness_ready_pending_ci
next_eligible_task: PILOT_AUDIT
attempt: 1
max_attempts: 3
branch: fix/TASK-03-reject-blank-customer-name
baseline_head: a3292835905d58a169aede27c1a9c1e1f9d905dc
implementation_head: 1fdee1081895d0be6d5a7c59c2526c57aa2e3400
validation_harness_head: ffc2eabe0f2d0ce7c980bb7a94eab7e33e2a4255
last_green_validated_head: 859269b9dcb8697d4ac67cb7a6221831c5a29747
merge_task_02: 712aae5f193e61cea6508b01d165480f3abe8e74
merge_task_03: b3d2f30ed9941c24b973c9addd7578e789d0730b
p1_finding: P1_LEGACY_UNSAFE_CUSTOMER_NAME_CONSTRAINT
p1_status: HARNESS_BOUNDING_FIX_PENDING_CI
p2_finding: P2_BLANK_CUSTOMER_NAME
p2_status: IMPLEMENTED_LOCAL
working_tree: clean
baseline_status: VERIFIED_GREEN
validation_status: LOCAL_GATES_PASS_POSTGRES_DEFERRED_TO_CI
review_status: P2_FINDINGS_FIXED_PENDING_NEW_CI_AND_HUMAN_REVIEW
ci_run: 31272281693
ci_status: LAST_GREEN_FOR_PRIOR_HEAD_NEW_CI_REQUIRED
last_green_ci_run: 31272281693
previous_main_ci_run: 31117339641
previous_main_ci_status: INFRASTRUCTURE_FAILURE
pr_number: 7
clean_main_ci_required: true
blockers:
  - P1_CI_SCENARIOS_REQUIRED
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
lessons_pending_validation:
  - LESSON-RCRM-0007
next_action: AWAIT_NEW_CI_FOR_CURRENT_HEAD
next_action_authorized: false
updated_at: "2026-08-08T00:00:00+02:00"
updated_by: ChatGPT
```

TASK-01, TASK-02 e TASK-03 permanecem concluídas e integradas; TASK-03 foi
mergeada em `b3d2f30`. O finding P1 de migration insegura para Customers legados
foi corrigido localmente com `NOT VALID` e validação condicional, sem alterar
dados. O harness `test:migration-compat` foi limitado ao prefixo anterior à
migration alvo. O CI verde `31272281693` valida somente o HEAD anterior
`859269b9dcb8697d4ac67cb7a6221831c5a29747`; os commits atuais exigem novo CI.
TASK-04 continua bloqueada, `next_eligible_task` permanece `PILOT_AUDIT` e o
modo segue `SUPERVISED_PILOT`.
