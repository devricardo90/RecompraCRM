# TASK-15 Spec — Validação final do roadmap

## Gate de fonte da verdade

Esta spec é a fonte da verdade da TASK-15. O `done_when` da entrada do
roadmap é literal:

> cliente → produto → venda → estoque → previsão → dashboard passa ponta a
> ponta.

Nada aqui reabre TASK-01..TASK-14, e nada aqui autoriza refatoração das
implementações já mergeadas. Se um defeito de task anterior aparecer, ele
vira achado registrado, não alteração de escopo desta task.

## Objetivo

Provar, com um teste determinístico e repetível, que a cadeia completa do
MVP funciona **através das rotas reais**, com um único registro percorrendo
todos os seis estágios e cada efeito a jusante verificado.

O que já existe prova cada fatia isoladamente. O que não existe é prova de
que as fatias se ligam.

## Auditoria da baseline

Cada verificação atual cobre um estágio e para ali:

| Verificação | O que prova | O que não prova |
| --- | --- | --- |
| `customer-model-check` | persistência de cliente | nada a jusante |
| `product-model-check` | persistência de produto | nada a jusante |
| `sale-model-check` | persistência de venda | efeito em estoque |
| `sale-stock-transaction-check` | decremento transacional de estoque | efeito em previsão |
| `sale-repurchase-forecast-check` | cálculo de `expectedRepurchaseAt` | aparição no dashboard |
| `repurchase-forecast-check` | classificação da projeção | ligação com uma venda recém-criada |
| `repurchase-dashboard-check` | agregação do dashboard | origem dos dados |
| `repurchase-api-integration-check` | rota `GET /api/repurchases` | os cinco estágios anteriores |
| `customer-api-integration-check` | rotas de cliente | venda/estoque/previsão |
| `product-api-integration-check` | rotas de produto | venda/estoque/previsão |
| `customer-history-check` | projeção de histórico | ligação com a venda criada nesta cadeia |
| `ui-hardening-check` | piso de acessibilidade estático | comportamento com dados reais |

Nenhuma delas cria um cliente, vende um produto a ele e depois confirma que
**aquele** cliente aparece na previsão e no dashboard. Essa costura é o
objeto desta task.

## Escopo: a cadeia, não as fatias

O teste percorre um caminho só, com identificadores únicos por execução:

1. **Cliente** — `POST /api/customers` cria um cliente com sufixo único.
2. **Produto** — `POST /api/products` cria um produto com estoque inicial
   conhecido e um `repurchaseIntervalDays` explícito.
3. **Venda** — `POST /api/sales` registra a venda ligando os dois.
4. **Estoque** — `GET /api/products/[id]` confirma o decremento exato
   (`estoque inicial − quantidade vendida`), não apenas "diminuiu".
5. **Previsão** — a venda passa a ter `expectedRepurchaseAt` derivado de
   `soldAt + repurchaseIntervalDays`, no contrato de data/hora que ARCH-02
   fixou (instante com timezone declarado).
6. **Dashboard** — `GET /api/repurchases` inclui **aquele** cliente, com a
   classificação correspondente à data prevista.

E a volta: `GET /api/customers/[id]/sales` mostra a venda no histórico
daquele cliente.

## Segurança dos dados

O banco de desenvolvimento contém dados pré-existentes. O teste:

- cria tudo o que usa, com sufixo `${Date.now()}-${process.pid}`;
- nunca atualiza nem apaga linha que não tenha criado;
- remove, no `finally`, exatamente os ids que criou, na ordem
  venda → produto → cliente;
- não depende de contagem global (`total de clientes`), só da presença dos
  seus próprios registros, para não quebrar quando o banco tem outros dados.

Uma asserção que dependa de estado global é defeito, não teste.

## Estratégia de testes

`scripts/task-15-e2e-check.mjs`, no mesmo idioma dos checks de integração já
existentes: sobe o Next em porta livre, exercita as rotas reais por HTTP,
usa Prisma apenas para preparar e limpar, e falha com mensagem que nomeia o
estágio.

A cadeia roda duas vezes com intervalos de recompra diferentes — um que cai
em `atrasado` e outro em `no prazo` — para que o estágio 6 prove
classificação, não só presença.

A camada visual fica com Playwright efêmero, conforme
`docs/operations/PLAYWRIGHT-EPHEMERAL.md`: `retries: 0`, artefatos apagados,
só o resumo permanece.

## Critérios de aceite

AC1. `scripts/task-15-e2e-check.mjs` existe e percorre os seis estágios em
uma única execução, com um único cliente e um único produto criados por ela.

AC2. O cliente é criado por `POST /api/customers` e o teste falha se a rota
não devolver o registro criado.

AC3. O produto é criado por `POST /api/products` com estoque inicial e
`repurchaseIntervalDays` explícitos.

AC4. A venda é criada por `POST /api/sales` ligando aquele cliente e aquele
produto.

AC5. O estoque resultante é conferido por `GET /api/products/[id]` contra o
valor exato esperado, não contra "menor que o inicial".

AC6. `expectedRepurchaseAt` da venda é conferido contra
`soldAt + repurchaseIntervalDays` no contrato de ARCH-02.

AC7. `GET /api/repurchases` inclui o cliente criado pela execução.

AC8. A classificação devolvida para esse cliente corresponde à data prevista,
provada com dois intervalos que caem em classificações diferentes.

AC9. `GET /api/customers/[id]/sales` inclui a venda criada pela execução.

AC10. O teste cria todos os registros que usa, com sufixo único por execução,
e não altera nenhuma linha pré-existente.

AC11. O teste remove no `finally` exatamente os ids que criou, e a limpeza
roda mesmo quando uma asserção falha.

AC12. Nenhuma asserção depende de contagem global ou de dado pré-existente
no banco.

AC13. Cada falha nomeia o estágio da cadeia em que ocorreu.

AC14. `npm run test:e2e-chain` executa o teste e entra no script agregado
`npm test`.

AC15. `.github/workflows/validate.yml` executa o teste em CI.

AC16. Playwright efêmero cobre a leitura visual da cadeia nas telas de venda,
estoque e dashboard, com `retries: 0` e artefatos apagados após PASS.

AC17. `docs/evidence/TASK-15-validation.md` registra o que foi provado por
teste determinístico, o que foi provado por Playwright, e o que
deliberadamente não foi coberto.

## Validação determinística

`npm run lint`, `npm run typecheck`, `npm run build`, `npm test` (incluindo
`test:e2e-chain`, novo) e `npm run test:loop-v1.4` verdes no HEAD exato do
PR.

## Definition of Done

- AC1 a AC17 provados por teste, não por inspeção;
- todos os gates determinísticos verdes no HEAD exato do PR;
- preflight determinístico passando antes de qualquer revisão despachada;
- revisão independente publicada para esse HEAD exato, sem findings em
  aberto;
- revisão publicada antes do merge;
- validação pós-merge verde no merge head antes de fechar a task;
- evidência em `docs/evidence/TASK-15-validation.md`;
- STATE, HANDOFF, ROADMAP e LOOP-REGISTER reconciliados — incluindo as
  narrativas, não só os campos rastreados pelo `roadmap_pointers_agree`.

## Não escopo

- Reabrir ou refatorar TASK-01..TASK-14.
- Deploy ou ambiente remoto: isso é TASK-16.
- Fechamento do roadmap: isso é TASK-17.
- Os seis itens de OWNER-02 que ficaram com ARCH-05.
- Testes de carga, performance ou concorrência além do que
  `sale-registration-concurrency-check` já cobre.

## Riscos conhecidos

**O teste sobe o Next e depende de porta livre.** Os checks de integração já
existentes têm esse mesmo risco e o resolvem com `findFreePort`; reusar o
mesmo padrão evita inventar um novo modo de falhar.

**A cadeia cruza o gatilho de previsão, que é assíncrono no banco.** ARCH-01
decidiu que o cálculo é síncrono e pertence ao trigger persistido; se a
leitura logo após o `POST /api/sales` vier sem `expectedRepurchaseAt`, isso é
achado real e não motivo para inserir espera arbitrária no teste.

**Dados pré-existentes no banco de desenvolvimento.** Ver "Segurança dos
dados": qualquer asserção global quebraria de forma intermitente e mascararia
o que a task quer provar.

## Assumptions explícitas

- **A1**: `DATABASE_URL` aponta para um banco com as migrações aplicadas;
  sem isso o teste falha imediatamente com mensagem explícita, em vez de
  passar vazio.
- **A2**: as rotas de escrita aceitam os campos que esta spec usa; se alguma
  exigir campo não previsto aqui, a divergência é achado e a spec é corrigida
  antes da implementação, não durante.
- **A3**: o contrato de data/hora de ARCH-02 (instante com timezone
  declarado) continua valendo e não é reaberto por esta task.
