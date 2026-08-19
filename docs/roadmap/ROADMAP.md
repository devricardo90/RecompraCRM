# Recompra CRM — Roadmap Executável MVP-01

status: RUNNING
objective: Permitir cadastro de clientes e produtos, registro de vendas, controle de estoque e identificação diária de clientes para recompra.
mode: CONTROLLED_AUTONOMOUS
loop_version: RICK_LOOP_V1_3
current_task: TASK-09
next_eligible_task: TASK-09

## Política

Uma task por loop. A próxima task só inicia após baseline verde, task spec derivada do SDD, validação determinística, revisão, handoff, lessons quando aplicável e atualização do state. A versão v1.3 do loop fica congelada até TASK-17 salvo defeito que bloqueie ou corrompa a execução.

- [x] TASK-01 — Fundação do projeto
- [x] TASK-02 — Banco e Prisma
- [x] TASK-03 — Modelo Customer
- [x] TASK-04 — Interface de clientes
- [x] TASK-05 — Modelo Product
- [x] TASK-06 — Interface de produtos e estoque
- [x] TASK-07 — Modelo de vendas
- [x] TASK-08 — Transação de venda e estoque
- [ ] TASK-09 — Previsão de recompra
  - depends_on: TASK-08
  - status: RECOVERING
  - branch: feat/TASK-09-repurchase-forecast
  - pr: 14
  - reviewed_head: 3344d6a3ff7bd25fbd9eacebc14473a071b31508
  - validation: Validate 31587932203 SUCCESS
  - blocking_review_findings: 2 P1
  - spec: docs/specs/TASK-09.md
  - done_when: fórmula canônica coberta por testes, migration segura para legado e revisão sem bloqueios.
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
