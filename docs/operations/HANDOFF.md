# Recompra CRM — Handoff do Último Loop

```yaml
schema_version: "1.0"
run_id: RCRM-MVP01-RUN-002
loop_id: RCRM-TASK-07-SALES-MODEL-ATTEMPT-03
status: TASK_07_VERIFIED_GREEN_AWAITING_FINAL_REVIEW
task: TASK-07
mode: CONTROLLED_AUTONOMOUS
previous_agent: ChatGPT
next_role: Autonomous Agent
baseline_head: 5ce2365179b0b9519bb7312fed3990543043493c
branch: feat/TASK-07-sales-model
atomic_implementation_head: 6f24ffc0b32ec69daa405e6977283cc9a27e7427
validation_harness_head: ffc2eabe0f2d0ce7c980bb7a94eab7e33e2a4255
last_green_validated_head: 940fce6fad7262aae7579a999c5fedb102a2233b
merge_task_03: b3d2f30ed9941c24b973c9addd7578e789d0730b
merge_pr_7_main: 44ae41746869f5dcf439f8903ff4d6be254aab9a
plan:
  - persistir Sale e SaleItem com relações obrigatórias a Customer e Product
  - exigir quantidade positiva e ao menos um item por venda confirmada no banco
  - preservar exclusões até TASK-08 definir restauração de estoque
  - validar a cadeia completa em PostgreSQL vazio e no CI
  - manter estoque, recompra, API e interface de vendas fora da TASK-07
changes:
  - "Migração 20260806204721_enforce_customer_name usa NOT VALID e validação condicional."
  - "Harness scripts/customer-migration-compat-check.mjs cria bancos isolados e executa migrate deploy real."
  - "Teste Customer cobre nome omitido, vazio, espaços, tabs e quebras de linha."
  - "Telefone normal, duplicado e múltiplos NULL continuam cobertos."
  - "STATE, evidence, HANDOFF, PILOT-AUDIT e LESSONS atualizados."
  - "Interface Customer implementada com lista, cadastro, edição, busca e empty state."
  - "API Customer adicionada em GET/POST /api/customers e PUT /api/customers/:id."
  - "Interface Product implementada com lista, busca, cadastro, edição e alerta de estoque baixo."
  - "API Product valida payloads e IDs no range PostgreSQL signed 32-bit INTEGER."
  - "Sale e SaleItem persistidos com FKs restritivas, quantidade positiva e trigger diferido de ao menos um item."
  - "Harness Sale integrado ao npm test e ao Validate."
  - "Trigger BEFORE DELETE bloqueia exclusão da Sale mesmo após remoção transacional dos itens."
  - "Harness Sale aplica migrations em schema único e remove schema/fixtures no finally."
validation: TASK_07_TECHNICAL_VERIFIED_GREEN
playwright_ephemeral: NOT_REQUIRED_NO_UI_CHANGE
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
  - "PostgreSQL local isolado e CI confirmaram persistência e integração Product."
  - "P1 de estoque vazio corrigido em 2b9cf167ee92875f5b869d9c1cbc1b70a5de14d8."
  - "P2 de payload INTEGER corrigido em 428992761162576e656e015840730c478f060f85."
  - "P2 de Product ID INTEGER corrigido em 7e1c9670535421af7bfce2e040bf306a2e783a08."
lessons_read:
  - LESSON-RCRM-0001
  - LESSON-RCRM-0002
  - LESSON-RCRM-0003
  - LESSON-RCRM-0004
  - LESSON-RCRM-0005
  - LESSON-RCRM-0006
  - LESSON-RCRM-0007
  - LESSON-RCRM-0008
lessons_created:
  - LESSON-RCRM-0006
  - LESSON-RCRM-0007
  - LESSON-RCRM-0008
evidence: docs/evidence/TASK-07-validation.md
pilot_evidence: docs/evidence/PILOT-AUDIT.md
ci_run: 31390596504
ci_status: SUCCESS
last_green_ci_run: 31390596504
previous_main_ci_run: 31117339641
previous_main_ci_status: INFRASTRUCTURE_FAILURE
pr_number: 11
current_task: TASK-07
next_eligible_task: TASK-07
technical_commit: 940fce6fad7262aae7579a999c5fedb102a2233b
validation_head: 940fce6fad7262aae7579a999c5fedb102a2233b
pr_8_status: MERGED
merge_pr_8_main_head: 19754d8d69c7d8d156ebeff5f42ef64a7c401814
local_validation_blocker: NONE
task_05_branch: feat/TASK-05-product-model
task_05_baseline: 8083428ad45b78eb18129ecd57a2abdc15455c61
pr_9_status: MERGED
task_05_implementation_head: 5c23f6dfc69669d9adf8143d5a41672d9da15336
task_05_validation_head: 5c23f6dfc69669d9adf8143d5a41672d9da15336
evidence_task_05: docs/evidence/TASK-05-validation.md
last_completed_task: TASK-06
task_05_merge_main_head: 198b2f276389a5fa2f7fca10d4b5923194710fb7
task_05_main_ci_run: 31319102311
task_06_branch: feat/TASK-06-product-interface
task_06_baseline: 163ff93b27edd6d7ab76525318c323b46ebdfb8c
task_06_implementation_head: 7e1c9670535421af7bfce2e040bf306a2e783a08
task_06_validation_head: 4382895c8a78062453ebb474f57cab038dcdaf93
task_06_integer_payload_fix_head: 428992761162576e656e015840730c478f060f85
task_06_integer_id_fix_head: 7e1c9670535421af7bfce2e040bf306a2e783a08
evidence_task_06: docs/evidence/TASK-06-validation.md
task_06_merge_main_head: c9cb0fba8a907ce46d385c2e03fa7411b48c03c8
task_06_main_ci_run: 31328149760
pr_10_status: MERGED
task_07_branch: feat/TASK-07-sales-model
task_07_baseline: 5ce2365179b0b9519bb7312fed3990543043493c
task_07_implementation_head: 940fce6fad7262aae7579a999c5fedb102a2233b
task_07_validation_head: 940fce6fad7262aae7579a999c5fedb102a2233b
task_07_ci_run: 31391071171
task_07_transactional_delete_fix_head: e1f4899f0425232dbc76c4236e654792f86e5835
task_07_isolated_harness_fix_head: 940fce6fad7262aae7579a999c5fedb102a2233b
evidence_task_07: docs/evidence/TASK-07-validation.md
pr_11_status: OPEN_AWAITING_FINAL_CODEX_REVIEW
next_action: AWAIT_FINAL_CODEX_REVIEW_AND_MERGE_IF_CLEAN
next_action_authorized: true
restart_command: git switch feat/TASK-07-sales-model && npm install
```

TASK-04 foi mergeada pelo PR #8 em `main` no commit
`19754d8d69c7d8d156ebeff5f42ef64a7c401814`. O fechamento documental em
`8083428ad45b78eb18129ecd57a2abdc15455c61` foi validado pelo Validate #36
(`31317857816`). A branch `feat/TASK-05-product-model` foi criada a partir
dessa baseline. O Validate #40 (`31319322422`) certificou a baseline usada pela TASK-06.
A implementação técnica final está no commit
`7e1c9670535421af7bfce2e040bf306a2e783a08`. O Validate #46
(`31325836264`) terminou `SUCCESS` com migrations, health, persistência,
integrações Customer/Product, lint, typecheck e build. Os campos numéricos e o
ID de Product respeitam o range PostgreSQL `INTEGER`; payloads e IDs oversized
retornam 400. Playwright efêmero passou em desktop, mobile e short-landscape.
O Codex revisou o HEAD final `4382895c8a78062453ebb474f57cab038dcdaf93`
sem major issues. O PR #10 foi mergeado em `main` no commit
`c9cb0fba8a907ce46d385c2e03fa7411b48c03c8`; o Validate #49
(`31328149760`) terminou `SUCCESS`. TASK-06 está concluída e TASK-07 é a
próxima task elegível. A TASK-07 está implementada em
`693c4504a6799fefdb28e0fff70fe37c1c780495`. O P2 de exclusão transacional foi
corrigido em `e1f4899f0425232dbc76c4236e654792f86e5835`. O harness foi isolado
sem fixtures persistentes em `940fce6fad7262aae7579a999c5fedb102a2233b`; o
Validate #55 (`31390596504`) passou. Sale/SaleItem possuem relações restritivas,
quantidade positiva, ao menos um item e bloqueio de exclusão da Sale. TASK-08
não foi iniciada; o próximo gate é a revisão final do PR #11.
