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
2. **Produto** — `POST /api/products` cria um produto com `currentStock`,
   `minimumStock` e `consumptionDays` explícitos. O campo aceito por
   `parseProductInput` é `consumptionDays`; não existe
   `repurchaseIntervalDays`.
3. **Venda** — `POST /api/sales` registra a venda ligando os dois. A rota
   aceita `customerId` e um array `items: [{ productId, quantity }]` — não um
   `productId`/`quantity` achatados na venda —, conforme `parseSaleInput`.
4. **Estoque** — `GET /api/products` confirma o decremento exato do produto
   criado (`estoque inicial − quantidade vendida`), não apenas "diminuiu".
   Não existe `GET /api/products/[id]`: a rota por id exporta apenas `PUT`,
   então a leitura é feita na listagem, selecionando pelo id criado.
5. **Previsão** — o **item** da venda passa a ter `expectedRepurchaseAt`
   igual a `soldAt + (quantity × consumptionDays) dias`, que é a fórmula que
   `compute_expected_repurchase_at` implementa, no contrato de data/hora que
   ARCH-02 fixou (instante com timezone declarado). O campo é uma coluna de
   `SaleItem`, não de `Sale`: a resposta de `POST /api/sales` o traz aninhado
   em `sale.items[].expectedRepurchaseAt`, e `GET /api/repurchases` o lê de
   `saleItem`. A quantidade faz parte da fórmula: omiti-la só acerta quando
   `quantity = 1`.
6. **Dashboard** — `GET /api/repurchases` inclui **aquele** cliente, com a
   classificação correspondente à data prevista.

E a volta: `GET /api/customers/[id]/sales` mostra a venda no histórico
daquele cliente.

## Segurança dos dados: schema isolado, não limpeza por linha

A primeira versão desta spec mandava apagar as linhas criadas no `finally`.
**Isso é impossível neste schema.** A migração
`20260809203000_add_sale_models` instala o trigger `Sale_deletion_blocked`,
que levanta exceção em *qualquer* `DELETE` sobre `Sale`, mesmo depois de os
`SaleItem` terem sido removidos — deliberadamente, porque restaurar estoque
exige uma política que TASK-08 não definiu.

Isso expõe um defeito nas verificações de integração já existentes: elas
fazem `prisma.sale.delete(...)` seguido de um `catch` vazio. O `catch` engole
a exceção do trigger, o `delete` do produto e do cliente falha em seguida por
chave estrangeira e também é engolido, e a limpeza *reporta sucesso sem ter
apagado nada*. É por isso que o banco de desenvolvimento acumulou registros
de execuções anteriores. Fica registrado como achado; corrigi-lo não é
escopo desta task.

Portanto o teste não limpa linhas — ele descarta o schema inteiro:

- deriva `DATABASE_URL` trocando `?schema=public` por um schema próprio,
  nomeado com timestamp e pid da execução;
- aplica as migrações nesse schema com `prisma migrate deploy`;
- roda a cadeia inteira lá dentro, com o Next apontado para essa URL;
- no `finally`, executa `DROP SCHEMA ... CASCADE`.

`DROP SCHEMA CASCADE` remove a tabela junto com o trigger, então não há
`DELETE` por linha para o trigger bloquear. O schema `public` não é lido nem
escrito em momento nenhum, o que torna a segurança dos dados uma
consequência estrutural e não uma questão de disciplina.

O teste continua não dependendo de contagem global: mesmo em schema vazio,
uma asserção sobre "total de clientes" acoplaria o teste a dados que ele não
criou. Uma asserção que dependa de estado global é defeito, não teste.

Se o `DROP SCHEMA` falhar, o teste falha ruidosamente em vez de engolir a
exceção — o erro oposto ao que as verificações existentes cometem.

## Estratégia de testes

`scripts/task-15-e2e-check.mjs`, no mesmo idioma dos checks de integração já
existentes: sobe o Next em porta livre e exercita as rotas reais por HTTP,
falhando com mensagem que nomeia o estágio. A diferença é o isolamento —
o Next e o Prisma apontam para o schema da execução, não para `public`, e
Prisma é usado para migrar, ler o `expectedRepurchaseAt` persistido e
descartar o schema no fim.

A cadeia roda duas vezes no mesmo schema, variando `soldAt` e
`consumptionDays` para que uma venda caia em `atrasado` e a outra em
`no prazo`, e com `quantity > 1` em pelo menos uma delas. Assim o estágio 6
prova classificação e não só presença, e o estágio 5 exercita a multiplicação
da fórmula em vez do caso degenerado `quantity = 1`.

A camada visual fica com Playwright efêmero, conforme
`docs/operations/PLAYWRIGHT-EPHEMERAL.md`: `retries: 0`, artefatos apagados,
só o resumo permanece.

## Critérios de aceite

AC1. `scripts/task-15-e2e-check.mjs` existe e percorre os seis estágios em
uma única execução, com um único cliente e um único produto criados por ela.

AC2. O cliente é criado por `POST /api/customers` e o teste falha se a rota
não devolver o registro criado.

AC3. O produto é criado por `POST /api/products` com `currentStock`,
`minimumStock` e `consumptionDays` explícitos.

AC4. A venda é criada por `POST /api/sales` com `customerId` e
`items: [{ productId, quantity }]`, ligando aquele cliente e aquele produto.

AC5. O estoque resultante é conferido por `GET /api/products`, selecionando o
produto criado pelo id, contra o valor exato esperado — não contra "menor que
o inicial".

AC6. O `expectedRepurchaseAt` do **item da venda** (coluna de `SaleItem`,
lido em `sale.items[].expectedRepurchaseAt`) é conferido contra
`soldAt + (quantity × consumptionDays) dias` no contrato de ARCH-02, com
`quantity > 1` em pelo menos uma execução para que a multiplicação seja
realmente exercida.

AC7. `GET /api/repurchases` inclui o cliente criado pela execução.

AC8. A classificação devolvida para esse cliente corresponde à data prevista,
provada com dois intervalos que caem em classificações diferentes.

AC9. `GET /api/customers/[id]/sales` inclui a venda criada pela execução.

AC18. Nenhum critério desta spec atribui `expectedRepurchaseAt` a `Sale`: o
campo pertence a `SaleItem`, e qualquer asserção o lê de lá.

AC10. O teste roda inteiramente em um schema próprio, criado por execução, e
nunca lê nem escreve no schema `public`.

AC11. O `finally` executa `DROP SCHEMA ... CASCADE` do schema da execução, e
roda mesmo quando uma asserção falha; uma falha no drop faz o teste falhar em
vez de ser engolida.

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

- AC1 a AC18 provados por teste, não por inspeção;
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

**`prisma migrate deploy` por execução custa tempo.** É o preço de não tocar
no schema `public`, e é determinístico — preferível a uma limpeza por linha
que o trigger de venda torna impossível.

**Schemas órfãos se o processo for morto entre a criação e o `DROP`.** Ficam
com prefixo identificável e timestamp, então são localizáveis e removíveis; o
risco é de higiene do ambiente, não de corrupção dos dados de
desenvolvimento.

## Assumptions explícitas

- **A1**: `DATABASE_URL` aponta para um banco com as migrações aplicadas;
  sem isso o teste falha imediatamente com mensagem explícita, em vez de
  passar vazio.
- **A2**: as rotas de escrita aceitam os campos que esta spec usa. Esta
  assumption já foi exercida: a revisão independente da própria spec mostrou
  que `POST /api/products` exige `consumptionDays` e não
  `repurchaseIntervalDays`, e que não existe `GET /api/products/[id]`. A spec
  foi corrigida antes da implementação, que é exatamente o que a assumption
  previa.
- **A3**: o contrato de data/hora de ARCH-02 (instante com timezone
  declarado) continua valendo e não é reaberto por esta task.
- **A4**: a forma das rotas de escrita é lida do código, não da memória. As
  duas rodadas de revisão desta spec corrigiram quatro divergências desse
  tipo (`consumptionDays`, ausência de `GET /api/products/[id]`, `items[]` em
  vez de campos achatados, e `expectedRepurchaseAt` em `SaleItem` e não em
  `Sale`). A implementação confere cada rota antes de usá-la.
