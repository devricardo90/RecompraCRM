# Recompra CRM — Handoff do Último Loop

```yaml
schema_version: "1.0"
run_id: RCRM-MVP01-RUN-002
loop_id: RCRM-TASK-06-PRODUCT-INTERFACE-ATTEMPT-01
status: TASK_06_VERIFIED_GREEN_AWAITING_CODEX_REVIEW
task: TASK-06
mode: CONTROLLED_AUTONOMOUS
previous_agent: ChatGPT
next_role: Autonomous Agent
baseline_head: 163ff93b27edd6d7ab76525318c323b46ebdfb8c
branch: feat/TASK-06-product-interface
atomic_implementation_head: 6f24ffc0b32ec69daa405e6977283cc9a27e7427
validation_harness_head: ffc2eabe0f2d0ce7c980bb7a94eab7e33e2a4255
last_green_validated_head: 2b9cf167ee92875f5b869d9c1cbc1b70a5de14d8
merge_task_03: b3d2f30ed9941c24b973c9addd7578e789d0730b
merge_pr_7_main: 44ae41746869f5dcf439f8903ff4d6be254aab9a
plan:
  - criar API mínima de Product para leitura, cadastro e edição persistentes
  - entregar tela `/products` mobile-first com lista, cadastro e edição
  - mostrar estado vazio, loading, erro e alerta de estoque baixo
  - validar integração da interface com PostgreSQL via API e navegador
  - manter vendas, redução de estoque e dashboards futuros fora do escopo
changes:
  - "Migração 20260806204721_enforce_customer_name usa NOT VALID e validação condicional."
  - "Harness scripts/customer-migration-compat-check.mjs cria bancos isolados e executa migrate deploy real."
  - "Teste Customer cobre nome omitido, vazio, espaços, tabs e quebras de linha."
  - "Telefone normal, duplicado e múltiplos NULL continuam cobertos."
  - "STATE, evidence, HANDOFF, PILOT-AUDIT e LESSONS atualizados."
  - "Interface Customer implementada com lista, cadastro, edição, busca e empty state."
  - "API Customer adicionada em GET/POST /api/customers e PUT /api/customers/:id."
validation: TASK_06_TECHNICAL_VERIFIED_GREEN
playwright_ephemeral: PASS_DESKTOP_MOBILE_SHORT_LANDSCAPE
review: AWAITING_CODEX_REVIEW
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
evidence: docs/evidence/TASK-06-validation.md
pilot_evidence: docs/evidence/PILOT-AUDIT.md
ci_run: 31321978521
ci_status: SUCCESS
last_green_ci_run: 31321978521
previous_main_ci_run: 31117339641
previous_main_ci_status: INFRASTRUCTURE_FAILURE
pr_number: 10
current_task: TASK-06
next_eligible_task: TASK-06
technical_commit: 2b9cf167ee92875f5b869d9c1cbc1b70a5de14d8
validation_head: 2b9cf167ee92875f5b869d9c1cbc1b70a5de14d8
pr_8_status: MERGED
merge_pr_8_main_head: 19754d8d69c7d8d156ebeff5f42ef64a7c401814
local_validation_blocker: POSTGRESQL_UNAVAILABLE_DOCKER_WSL
task_05_branch: feat/TASK-05-product-model
task_05_baseline: 8083428ad45b78eb18129ecd57a2abdc15455c61
pr_9_status: MERGED
task_05_implementation_head: 5c23f6dfc69669d9adf8143d5a41672d9da15336
task_05_validation_head: 5c23f6dfc69669d9adf8143d5a41672d9da15336
evidence_task_05: docs/evidence/TASK-05-validation.md
last_completed_task: TASK-05
task_05_merge_main_head: 198b2f276389a5fa2f7fca10d4b5923194710fb7
task_05_main_ci_run: 31319102311
task_06_branch: feat/TASK-06-product-interface
task_06_baseline: 163ff93b27edd6d7ab76525318c323b46ebdfb8c
task_06_implementation_head: 2b9cf167ee92875f5b869d9c1cbc1b70a5de14d8
task_06_validation_head: 2b9cf167ee92875f5b869d9c1cbc1b70a5de14d8
evidence_task_06: docs/evidence/TASK-06-validation.md
pr_10_status: OPEN_READY_FOR_REVIEW
next_action: REQUEST_CODEX_REVIEW
next_action_authorized: true
restart_command: git switch feat/TASK-06-product-interface && npm install
```

TASK-04 foi mergeada pelo PR #8 em `main` no commit
`19754d8d69c7d8d156ebeff5f42ef64a7c401814`. O fechamento documental em
`8083428ad45b78eb18129ecd57a2abdc15455c61` foi validado pelo Validate #36
(`31317857816`). A branch `feat/TASK-05-product-model` foi criada a partir
dessa baseline. O Validate #40 (`31319322422`) está verde e a TASK-06 é a atividade corrente.
A correção técnica está no commit `2b9cf167ee92875f5b869d9c1cbc1b70a5de14d8`.
O Validate #43 (`31321978521`) terminou `SUCCESS` com migrations, health,
persistência, integrações Customer/Product, lint, typecheck e build; o P1 de
campos de estoque vazios está coberto pela UI e pelo harness. Playwright
efêmero passou em desktop, mobile e short-landscape. O PR #10 está aberto e
pronto para revisão, mas a revisão Codex do novo HEAD está bloqueada
externamente: `codex` não é colaborador e a solicitação formal retornou HTTP
422. TASK-07 não foi iniciada.
