# TASK-11 Spec — Histórico do cliente

Status: SPEC_REVIEWED_ROUND_1_APPROVED_FOR_IMPLEMENTATION
Source: `docs/product/PROJECT-SDD.md` + `docs/roadmap/ROADMAP.md`
Depends on: TASK-10 (registro de venda)
Baseline: `c3b8e16704a0b1971d8d5f3802fa9a18d99b0976` (main)
Branch: `feat/TASK-11-customer-history`

Canonical requirement, from the roadmap: *"histórico correto, ordenado e com
previsões"*. The SDD does not define customer history beyond that, so every
decision below is either derived from verifiable behaviour of the current system
or recorded as an explicit assumption in the section "Assumptions".

## Definição canônica

O **histórico de um cliente** é a lista das vendas cujo `Sale.customerId` é
aquele cliente, ordenada de forma determinística, cada venda acompanhada dos
seus itens, e cada item acompanhado da sua previsão de recompra
(`SaleItem.expectedRepurchaseAt`).

O histórico é uma **projeção de leitura**. Ele não cria, altera nem apaga nada.

## Quais vendas pertencem ao cliente

Exatamente as vendas com `Sale.customerId = :id`. Sem filtro adicional.

Não há filtro por `Sale.status` porque **não existe vocabulário canônico de
status** no sistema: o registro de venda da TASK-10 grava `"CONFIRMED"`, os
harnesses gravam `"MODEL_TEST"`, e o SDD não define estados. Cancelamento e
estorno estão fora do MVP. Inventar um filtro aqui criaria uma regra que nada
sustenta — ver "Assumptions" A1.

## Ordenação determinística

Ordem **total**, portanto reproduzível:

| Nível | Critério |
| --- | --- |
| vendas | `soldAt DESC`, desempate `id DESC` |
| itens dentro da venda | `productId ASC`, desempate `id ASC` |

`Sale.id` é único, então o desempate torna a ordem de vendas total mesmo quando
várias vendas compartilham o mesmo `soldAt` — caso real, porque `soldAt` pode ser
informado pelo cliente da API e várias vendas podem cair no mesmo instante.

`productId ASC` sozinho **não** é ordem total dos itens: o schema não torna
`(saleId, productId)` único, e duas linhas do mesmo produto na mesma venda são
possíveis. O fluxo da TASK-10 normaliza duplicatas e não as produz, mas escrita
direta e dados legados produzem — os próprios harnesses das TASK-09/10 criam
vendas com dois itens do mesmo produto. Sem desempate, essas linhas podem voltar
em qualquer ordem. Por isso o desempate por `id ASC`, e por isso a evidência
precisa cobrir venda com produto repetido.

`productId ASC` continua sendo a mesma ordem em que a TASK-10 grava os itens e em
que `GET /api/sales` já os devolve, então a leitura não contradiz a escrita.

## Campos exibidos

Por venda:

- data da venda (`soldAt`);
- quantidade de itens;
- observação (`notes`), quando existir.

Por item:

- nome do produto (**atual** — ver "Semântica de nome e preço");
- quantidade;
- unidade do produto;
- previsão de recompra (`expectedRepurchaseAt`), ou `—` quando `NULL`.

`expectedRepurchaseAt` pode ser `NULL` para linhas legadas cuja previsão não é
representável (política da TASK-09). O histórico exibe `—`; não recalcula e não
esconde a linha.

## Semântica de nome e preço

Duas decisões que precisam ficar explícitas porque são semânticas, não estéticas.

**Preço não é exibido.** `SaleItem.unitPrice` existe no schema, é anulável, e o
fluxo de registro de venda da TASK-10 **nunca o grava** — verificado: uma venda
criada pelo fluxo normal produz `unitPrice = null`. Não há dado de preço no
sistema. Exibir preço exigiria capturá-lo no registro da venda, o que é escopo
da TASK-10, não desta task. Ver "Assumptions" A2.

**O nome do produto exibido é o atual, não um histórico.** `SaleItem` referencia
`Product` por chave estrangeira e não guarda snapshot de nome. Verificado:
renomear um produto muda o nome mostrado em vendas passadas. O histórico assume
essa semântica em vez de simular outra.

Adicionar colunas de snapshot a `SaleItem` está **fora do escopo**: `SaleItem` é
o centro da malha de triggers das TASK-07/08/09, e alterá-la reabre superfície
de concorrência já fechada, sem que o SDD peça histórico imutável de nome. Fica
registrado como limitação conhecida — ver "Limitações registradas" L1.

## Produto ou cliente removido

Não existe esse caso hoje, e isso é verificável:

- não há endpoint `DELETE` em nenhuma rota da aplicação;
- `SaleItem.productId` e `Sale.customerId` usam `onDelete: Restrict` —
  verificado: apagar um produto referenciado por uma venda é bloqueado, e apagar
  um cliente com vendas também.

Portanto o histórico não precisa tratar referência pendente. Se um dia a
exclusão for permitida, esta seção precisa ser revisitada antes.

## Isolamento entre clientes

O histórico de um cliente **nunca** pode conter venda de outro cliente. É a
propriedade mais importante desta task e precisa de prova direta: um teste com
dois clientes, cada um com vendas, exigindo que cada histórico contenha
exatamente as suas.

## Paginação

O histórico cresce sem limite, então a leitura é paginada.

- `limit`: padrão `20`, máximo `50`; valor inválido ou fora da faixa ⇒ `400`;
- `cursor`: `Sale.id` da última venda da página anterior; ausente ⇒ primeira
  página;
- resposta inclui `nextCursor` (ou `null` quando não há mais páginas);
- paginação por cursor, não por `offset`.

**O seek é composto, não escalar.** `Sale.id` sozinho não é valor de corte
válido para `soldAt DESC, id DESC`: `soldAt` é informado pelo chamador, então uma
venda pode ser retroagida e a ordem de `id` deixar de acompanhar a ordem de
`soldAt`. Uma implementação do tipo `id < cursor` pularia ou repetiria linhas
válidas enquanto ainda parecesse seguir um cursor escalar.

O contrato é:

1. resolver a venda do `cursor`;
2. exigir que ela pertença ao cliente `:id` — se existir mas for de outro
   cliente, responder `400`. Sem essa checagem, o `soldAt` de uma venda alheia
   viraria a fronteira do seek e parte do histórico do cliente sumiria
   silenciosamente;
3. seguir lexicograficamente por `(soldAt, id)`: retornar as vendas com
   `soldAt < cursor.soldAt`, mais as com `soldAt = cursor.soldAt AND id <
   cursor.id`;
4. `cursor` inexistente ⇒ `400`.

**Invariante sob escrita concorrente**, enunciada de forma não contraditória: uma
travessia cobre **exatamente uma vez cada venda do conjunto existente quando a
travessia começou**. Uma venda registrada no meio da navegação, com `soldAt` mais
recente que o cursor, ordena *antes* do ponto de corte e por construção não pode
aparecer em nenhuma página seguinte — ela só aparece ao recarregar. O que a
paginação garante é ausência de duplicata e ausência de salto no conjunto
original, não uma visão instantânea do total pós-inserção.

## Estados de interface

- **carregando**: skeleton, sem layout shift;
- **erro**: mensagem legível e botão "Tentar novamente";
- **vazio**: estado próprio, textualmente distinto de erro e de cliente
  inexistente, convidando a registrar a primeira venda;
- **cliente inexistente**: `404` na API e mensagem própria na interface.

## Fronteiras de API e domínio

Nova rota de leitura:

```
GET /api/customers/:id/sales?limit=<1..50>&cursor=<saleId>
```

| Situação | HTTP |
| --- | --- |
| sucesso | `200` com `{ customer, sales, nextCursor }` |
| `id` não inteiro ou fora do range `INTEGER` | `400` |
| `limit`/`cursor` inválidos | `400` |
| cliente inexistente | `404` |
| falha de banco/indisponibilidade | `503` |

Regras de fronteira:

- a rota é **somente leitura**; não escreve `Sale`/`SaleItem` em nenhuma
  hipótese;
- qualquer escrita futura de venda continua obrigada a passar por
  `lib/sales/saleTransaction.ts` (contrato herdado da TASK-10);
- `expectedRepurchaseAt` é derivado no banco: a rota apenas o lê;
- a interface não recalcula previsão nem estoque.

## Fuso horário de exibição

O SDD exige datas "exibidas no fuso do negócio" mas **não define esse fuso**. As
TASK-04 e TASK-06 adiaram exibir datas exatamente por isso; a TASK-10 passou a
exibir a previsão usando o fuso do navegador, o que é inconsistente com aquele
adiamento e desloca o dia perto da meia-noite.

Como o histórico é feito de datas, isso não pode continuar indefinido aqui.
Decisão: renderizar `soldAt` e `expectedRepurchaseAt` como **datas de calendário
em um único fuso declarado**, `America/Sao_Paulo`, definido em um só lugar
(`lib/format/businessDate.ts`) e aplicado também à exibição já existente da
TASK-10, para o aplicativo ter uma regra só.

É uma **assumption** (A3), não um fato do SDD, e foi isolada num único módulo
justamente para poder ser trocada em um ponto quando o fuso canônico for
definido.

### Trocar só o formatador não basta

`POST /api/sales` aceita `soldAt` só com data (`"2026-08-20"`), e o JavaScript
interpreta isso como **meia-noite UTC**. Formatar esse instante em
`America/Sao_Paulo` (UTC−3) exibiria `19/08/2026` — um dia antes do que o
chamador informou — e a previsão derivada desloca junto. Ou seja, aplicar A3
apenas na exibição transformaria datas válidas em datas erradas.

Então a regra é de **interpretação e armazenamento**, não só de exibição:

| Entrada | Interpretação |
| --- | --- |
| só data, `YYYY-MM-DD` | meia-noite **no fuso do negócio**, armazenada como o instante UTC correspondente |
| data e hora com offset explícito (`Z`, `+HH:MM`) | instante exato informado, respeitado como veio |
| data e hora sem offset | meia-noite/hora local **no fuso do negócio** |
| ausente | instante atual |

Com isso, `soldAt: "2026-08-20"` é armazenado como `2026-08-20T03:00:00Z` e
exibido como `20/08/2026`, e a previsão canônica cai no dia de calendário certo.

Esta regra altera o parsing da TASK-10, que hoje faz `new Date(valor)`. É
alteração deliberada e necessária: sem ela A3 quebra dados válidos. Precisa de
testes de fronteira para entrada só-data, entrada com offset e virada de dia.

## Assumptions

| # | Assumption | Por que, e o que a derrubaria |
| --- | --- | --- |
| A1 | O histórico mostra todas as vendas do cliente, sem filtrar por `status` | Não existe vocabulário canônico de status nem cancelamento no MVP. Cai se o SDD definir estados e disser que algum não conta como histórico. |
| A2 | O histórico não exibe preço | `unitPrice` nunca é gravado pelo fluxo atual (verificado: `null`). Cai quando o registro de venda passar a capturar preço. |
| A3 | Fuso de exibição é `America/Sao_Paulo` | Projeto inteiramente pt-BR; SDD exige "fuso do negócio" sem defini-lo. Cai quando o fuso canônico for definido — trocar em `lib/format/businessDate.ts`. |
| A4 | `limit` padrão 20 / máximo 50 | Alinha com o `take: 20` já usado em `GET /api/sales`. Cai se o produto pedir outro volume. |

## Limitações registradas

| # | Limitação |
| --- | --- |
| L1 | Renomear um produto altera o nome exibido em vendas passadas; não há snapshot histórico de nome. Fora do escopo por tocar `SaleItem`, centro da malha de triggers TASK-07/08/09. |
| L2 | Sem preço no histórico enquanto o registro de venda não capturar preço. |

## Fora do escopo

- classificação de recompra vencida/hoje/próximos sete dias (TASK-12);
- dashboard de estoque (TASK-13);
- edição, cancelamento ou estorno de venda;
- exportação, impressão ou relatório;
- decidir o ARCH-01 (previsão persistida vs calculada) — não bloqueia esta task.

## Critérios de aceitação

**Mobile (390×844)** — alvo primário:

- histórico acessível a partir do cliente na tela de clientes;
- cada venda mostra data, itens e previsão sem rolagem horizontal;
- alvos de toque com no mínimo 44 px de altura;
- estados de carregando, vazio, erro e cliente inexistente visíveis e
  distinguíveis.

**Desktop (1280×900)**:

- mesmo conteúdo e mesma ordem, aproveitando a largura sem quebrar a hierarquia;
- navegação de volta para clientes funciona.

## Evidência determinística exigida

Harness PostgreSQL real, schema isolado por execução, no padrão das TASK-07..10:

1. ordenação total: vendas com `soldAt` iguais desempatam por `id DESC` de forma
   reproduzível;
2. itens ordenados por `productId ASC` com desempate `id ASC`, incluindo uma
   venda com **duas linhas do mesmo produto** (escrita direta, como fazem os
   harnesses das TASK-09/10);
3. isolamento: dois clientes com vendas, cada histórico contém exatamente as
   suas;
4. previsões conferem com a fórmula canônica e `NULL` aparece como ausência, não
   como erro;
5. histórico vazio devolve lista vazia, não erro;
6. cliente inexistente é distinguido de histórico vazio;
7. paginação por cursor: páginas não se sobrepõem e cobrem exatamente uma vez o
   conjunto existente no início da travessia;
8. paginação com **venda retroagida**, em que a ordem de criação contraria a
   ordem de `soldAt`, provando que o seek é composto e não por `id`;
9. cursor que existe mas pertence a **outro cliente** é rejeitado com `400`, e o
   histórico do cliente permanece completo;
10. inserir uma venda mais recente no meio da travessia não duplica nem pula
    nenhuma venda do conjunto original;
11. `limit` fora da faixa é rejeitado, e `cursor` inexistente também;
12. `soldAt` só com data é armazenado e exibido no mesmo dia de calendário do
    fuso do negócio, incluindo o caso de virada de dia, e entrada com offset
    explícito é respeitada como instante;
13. renomear um produto reflete no histórico — comportamento declarado em L1,
    coberto por teste para que a mudança seja consciente e não acidental.

Playwright efêmero obrigatório (há interface), mobile e desktop, conforme
`docs/operations/PLAYWRIGHT-EPHEMERAL.md`.

## Done when

- histórico correto, ordenado e com previsões, por cliente;
- isolamento entre clientes provado;
- paginação determinística provada;
- estados de carregando, vazio, erro e cliente inexistente implementados;
- fuso unificado em um único módulo, aplicado tanto à exibição quanto à
  interpretação de `soldAt` só-data no registro de venda;
- harness determinístico e Playwright efêmero verdes;
- lint, typecheck, build e suíte de regressão verdes;
- revisão independente sem findings bloqueantes no HEAD exato;
- CI verde nesse mesmo HEAD;
- STATE/HANDOFF/evidence reconciliados.
