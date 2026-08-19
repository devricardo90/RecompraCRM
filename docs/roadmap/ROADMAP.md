# Recompra CRM — Roadmap Executável MVP-01

status: RUNNING
objective: Permitir cadastro de clientes e produtos, registro de vendas, controle de estoque e identificação diária de clientes para recompra.
mode: CONTROLLED_AUTONOMOUS
loop_version: RICK_LOOP_V1_3
current_task: TASK-10
next_eligible_task: TASK-10

## Política

Uma task por loop. A próxima task só inicia após baseline verde, task spec derivada do SDD, validação determinística, revisão, handoff, lessons quando aplicável e atualização do state. A versão v1.3 do loop fica congelada até TASK-17 salvo defeito que bloqueie ou corrompa a execução.

- [x] TASK-01 — Fundação do projeto
  - depends_on: none
  - done_when: Next.js + TypeScript + Tailwind iniciam; lint, typecheck e build passam.
  - verified_head: 218df9eb9a6a7d17af6accdd83b7e41df303fa33
  - evidence: docs/evidence/TASK-01-validation.md
- [x] TASK-02 — Banco e Prisma
  - depends_on: TASK-01
  - done_when: PostgreSQL e Prisma configurados; migração inicial reproduzível.
  - verified_head: 712aae5f193e61cea6508b01d165480f3abe8e74
  - review: PR #5 aprovado tecnicamente; CI remoto 31112180901 PASS; integrada em main.
  - evidence: docs/evidence/TASK-02-validation.md
- [x] TASK-03 — Modelo Customer
  - depends_on: TASK-02
  - done_when: CRUD e validações de cliente passam.
  - status: COMPLETED
  - baseline: 712aae5f193e61cea6508b01d165480f3abe8e74
  - implementation_head: 6f24ffc0b32ec69daa405e6977283cc9a27e7427
  - merge_main: 44ae41746869f5dcf439f8903ff4d6be254aab9a
  - final_validation: Validate #26 / 31306424995 SUCCESS
  - evidence: docs/evidence/TASK-03-validation.md
- [x] TASK-04 — Interface de clientes
  - depends_on: TASK-03
  - done_when: lista, cadastro, edição, busca e empty state validados no navegador.
  - status: COMPLETED
  - baseline: 2d7e8c4a2d03131b5c7512f2b114a7efefd9e2fb
  - technical_head: b3e87a062fb62ce5a97fbde0840db31851e9af28
  - final_implementation_head: d34591a0fcae06b03fb2ab52a9c8d4acd7202e89
  - validation_head: 19754d8d69c7d8d156ebeff5f42ef64a7c401814
  - merge_main: 19754d8d69c7d8d156ebeff5f42ef64a7c401814
  - final_validation: Validate #35 / 31317395962 SUCCESS
  - pr: #8 MERGED
  - evidence: docs/evidence/TASK-04-validation.md
  - validation: lint/typecheck/build/Playwright/PostgreSQL/Customer API CI PASS
  - date_display: deferred until business timezone is canonically defined
- [x] TASK-05 — Modelo Product
  - depends_on: TASK-02
  - status: COMPLETED
  - branch: feat/TASK-05-product-model
  - baseline: 8083428ad45b78eb18129ecd57a2abdc15455c61
  - baseline_ci: Validate #36 / 31317857816 SUCCESS
  - technical_head: 5c23f6dfc69669d9adf8143d5a41672d9da15336
  - validation_head: 5c23f6dfc69669d9adf8143d5a41672d9da15336
  - validation: Validate #37 / 31318451893 SUCCESS
  - merge_main: 198b2f276389a5fa2f7fca10d4b5923194710fb7
  - final_validation: Validate #39 / 31319102311 SUCCESS
  - pr: #9 MERGED
  - evidence: docs/evidence/TASK-05-validation.md
  - done_when: CRUD de produtos com estoque, mínimo e duração.
- [x] TASK-06 — Interface de produtos e estoque
  - depends_on: TASK-05
  - status: COMPLETED
  - branch: feat/TASK-06-product-interface
  - baseline: 163ff93b27edd6d7ab76525318c323b46ebdfb8c
  - baseline_ci: Validate #40 / 31319322422 SUCCESS
  - technical_head: 7e1c9670535421af7bfce2e040bf306a2e783a08
  - reviewed_head: 4382895c8a78062453ebb474f57cab038dcdaf93
  - validation_head: c9cb0fba8a907ce46d385c2e03fa7411b48c03c8
  - validation: Validate #49 / 31328149760 SUCCESS
  - merge_main: c9cb0fba8a907ce46d385c2e03fa7411b48c03c8
  - pr: #10 MERGED
  - done_when: fluxo de produtos e alertas básicos validados no navegador.
- [x] TASK-07 — Modelo de vendas
  - depends_on: TASK-03, TASK-05
  - status: COMPLETED
  - branch: feat/TASK-07-sales-model
  - baseline: 5ce2365179b0b9519bb7312fed3990543043493c
  - baseline_ci: Validate #50 / 31329344342 SUCCESS
  - initial_technical_head: 693c4504a6799fefdb28e0fff70fe37c1c780495
  - deletion_fix_head: e1f4899f0425232dbc76c4236e654792f86e5835
  - sale_id_immutable_fix_head: c4bfbc40b73470ca4e919e3b098bf4a95b78c620
  - technical_head: 76c637cc9d31fb53acdc5ff492e1e2951dddeca6
  - validation_head: 76c637cc9d31fb53acdc5ff492e1e2951dddeca6
  - validation: Validate #59 / 31408117992 SUCCESS
  - docs_reconciled_through: 691d89c13bfc770f59af54ec97bd0b90845ed3ab
  - review: REVIEW_CARRY_FORWARD_PASS (technical_review_anchor 76c637c, administrative_tail_head 691d89c)
  - pr: #11 MERGED
  - merge_main: e7fbb545d0640219846b55b0c23a9c0add878147
  - main_ci: Validate 31418506819 SUCCESS
  - evidence: docs/evidence/TASK-07-validation.md
  - done_when: Sale e SaleItem persistidos com integridade.
- [x] TASK-08 — Transação de venda e estoque
  - depends_on: TASK-07
  - status: COMPLETED
  - branch: feat/TASK-08-sale-stock-transaction
  - baseline: 9d050028cd2dbc95bacfc8dd6b91e32c13d345b9
  - implementation_head: 00c3b0bbdda5eac8b1dc0f2a739d037d82ba98a0
  - validation_head: 827f2fdc51c6d7a882ab51213c8504dde231667e
  - review: CODEX_REVIEW_CLEAN (3 rounds; 2 findings fixed)
  - pr: #12 MERGED
  - merge_main: 0b31d5b13aab763b2bd87f0eaf109b8b21c1941f
  - main_ci: Validate 31480804711 SUCCESS
  - evidence: docs/evidence/TASK-08-validation.md
  - done_when: venda reduz estoque atomicamente e falha sem atualização parcial.
- [x] TASK-09 — Previsão de recompra
  - depends_on: TASK-08
  - status: COMPLETED
  - baseline: 0b31d5b13aab763b2bd87f0eaf109b8b21c1941f
  - branch: feat/TASK-09-repurchase-forecast
  - pr: #14 MERGED (squash)
  - technical_head: 82c68a7e6c73a0f141a2c8b30ae7d7632b750dee
  - branch_ci: Validate 32274791956 SUCCESS
  - review: CODEX_REVIEW_CLEAN on 82c68a7e6c73a0f141a2c8b30ae7d7632b750dee (9 rounds; 11 findings fixed, 1 residual accepted)
  - merge_main: e4de101bcbd9d632a72c6a81efb3cf02a7cf0c8d
  - main_ci: Validate 32282972720 SUCCESS
  - spec: docs/specs/TASK-09.md
  - evidence: docs/evidence/TASK-09-validation.md
  - accepted_residual: per-row lock ordering leaves a retryable 40P01 for multi-item SaleItem statements; contracted away in TASK-10
  - architecture_signal: ARCHITECTURE_COMPLEXITY_SIGNAL (9 review rounds) -> ARCH-01
  - done_when: fórmula canônica coberta por testes, migration segura para legado e revisão sem bloqueios.
- [ ] TASK-10 — Interface de registro de venda
  - depends_on: TASK-04, TASK-06, TASK-09
  - spec: docs/specs/TASK-10.md
  - concurrency_contract: obrigatório — ver TASK-09 accepted_residual e a seção "Contrato de concorrência" do spec
  - done_when: fluxo mobile-first validado com Playwright efêmero.
- [ ] TASK-11 — Histórico do cliente
  - depends_on: TASK-10
  - done_when: histórico correto, ordenado e com previsões.
- [ ] TASK-12 — Dashboard de recompra
  - depends_on: TASK-09, TASK-11
  - done_when: classificação correta de vencidos, hoje e próximos sete dias.
- [ ] TASK-13 — Dashboard de estoque
  - depends_on: TASK-06, TASK-08
  - done_when: alertas atualizam após vendas.
- [ ] TASK-14 — Hardening do MVP
  - depends_on: TASK-01..TASK-13
  - done_when: erros, loading, empty states, acessibilidade e responsividade sem bloqueios.
- [ ] TASK-15 — Validação final do roadmap
  - depends_on: TASK-14
  - done_when: cliente → produto → venda → estoque → previsão → dashboard passa ponta a ponta.
- [ ] TASK-16 — Deploy de homologação
  - depends_on: TASK-15
  - done_when: homologação disponível, smoke remoto aprovado e sem credenciais expostas.
- [ ] TASK-17 — Fechamento do roadmap MVP-01
  - depends_on: TASK-16
  - done_when: 17/17 tasks verificadas e estado ROADMAP_COMPLETED_WAITING_HUMAN.

## Itens de arquitetura (não bloqueantes)

Itens levantados por evidência de execução. Não reabrem tasks concluídas e não
autorizam refatoração imediata.

- [ ] ARCH-01 — Avaliar previsão de recompra persistida vs calculada
  - origin: ARCHITECTURE_COMPLEXITY_SIGNAL emitido na TASK-09 (9 rodadas de revisão com defeitos distintos e confirmados)
  - subsystem: SaleItem.expectedRepurchaseAt e a malha de triggers Sale/SaleItem/Product
  - blocking: false
  - status: OPEN
  - decide_before: TASK-12 — Dashboard de recompra (primeiro consumidor forte do campo)
  - question: `expectedRepurchaseAt` deve continuar sendo um campo derivado persistido de forma síncrona por triggers PostgreSQL?
  - options:
      - A. modelo atual, persistido e mantido por triggers
      - B. cálculo na leitura (view ou expressão de consulta)
      - C. projeção assíncrona/materializada, se justificável
  - criteria: complexidade de concorrência; superfície de deadlock; amplificação de escrita; desempenho de leitura/consulta; requisitos de histórico e dashboard; consistência dos dados; complexidade de migração; observabilidade; manutenibilidade
  - evidence: docs/evidence/TASK-09-validation.md; LESSON-RCRM-0009..0014
  - non_goal: não refatorar a TASK-09 agora
