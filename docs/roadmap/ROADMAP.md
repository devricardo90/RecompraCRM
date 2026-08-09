# Recompra CRM — Roadmap Executável MVP-01

status: RUNNING
objective: Permitir cadastro de clientes e produtos, registro de vendas, controle de estoque e identificação diária de clientes para recompra.
mode: CONTROLLED_AUTONOMOUS
current_task: TASK-04
next_eligible_task: TASK-05

## Política

Uma task por loop. A próxima task só inicia após baseline verde, validação determinística, revisão, handoff, lessons quando aplicável e atualização do state.

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
  - validation_head: d34591a0fcae06b03fb2ab52a9c8d4acd7202e89
  - final_validation: Validate #33 / 31316500371 SUCCESS
  - pr: #8 OPEN_READY_FOR_REVIEW
  - evidence: docs/evidence/TASK-04-validation.md
  - validation: lint/typecheck/build/Playwright/PostgreSQL/Customer API CI PASS
  - date_display: deferred until business timezone is canonically defined
- [ ] TASK-05 — Modelo Product
  - depends_on: TASK-02
  - done_when: CRUD de produtos com estoque, mínimo e duração.
- [ ] TASK-06 — Interface de produtos e estoque
  - depends_on: TASK-05
  - done_when: fluxo de produtos e alertas básicos validados no navegador.
- [ ] TASK-07 — Modelo de vendas
  - depends_on: TASK-03, TASK-05
  - done_when: Sale e SaleItem persistidos com integridade.
- [ ] TASK-08 — Transação de venda e estoque
  - depends_on: TASK-07
  - done_when: venda reduz estoque atomicamente e falha sem atualização parcial.
- [ ] TASK-09 — Previsão de recompra
  - depends_on: TASK-08
  - done_when: fórmula canônica coberta por testes.
- [ ] TASK-10 — Interface de registro de venda
  - depends_on: TASK-04, TASK-06, TASK-09
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
