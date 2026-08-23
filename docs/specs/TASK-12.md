# TASK-12 Spec — Dashboard de recompra

Status: SPEC_DRAFT_AWAITING_REVIEW
Source: Google Docs `Fonte da Verdade - Recompra CRM` + `docs/product/PROJECT-SDD.md` + `docs/roadmap/ROADMAP.md` + `docs/architecture/ARCH-01-decision.md`
Depends on: TASK-09, TASK-11, ARCH-01
Baseline: `b72670fec890d1687a5f69e1e544ce38cd8f4d0e` (`main`)
Branch: `feat/TASK-12-repurchase-dashboard`

## Gate de fonte da verdade

O SDD do repositório define, para esta task, uma única regra de produto:

> O dashboard mostra recompra vencida, hoje e próximos sete dias.

E a regra de origem da previsão:

> A previsão inicial é: data da venda + quantidade vendida × dias de consumo por unidade.
> Vendas com vários produtos geram previsões por item.

O roadmap acrescenta `done_when: classificação correta de vencidos, hoje e próximos sete dias`.

Não há contradição entre SDD, roadmap e ARCH-01 para esta task. ARCH-01 está
`RESOLVED` na Opção A e é dependência satisfeita, não item aberto. ARCH-02
(consolidação do contrato de data/hora) e ARCH-03 (consolidação do contrato de
espera/revisão do loop) permanecem abertos e **não** autorizam refatoração aqui.

## Objetivo

Entregar uma visão mobile-first, **somente leitura**, que mostre quais recompras
estão vencidas, quais são hoje e quais caem nos próximos sete dias, a partir da
verdade já persistida em `SaleItem.expectedRepurchaseAt`.

A task não cria uma segunda regra de previsão, não recalcula previsão, não
escreve em `expectedRepurchaseAt` e não altera venda nem estoque.

## Contrato de previsão herdado do ARCH-01

Opção A: `SaleItem.expectedRepurchaseAt` é a fonte da verdade de leitura, e seu
valor canônico é derivado e mantido **sincronicamente por triggers PostgreSQL**:

```text
Sale.soldAt + SaleItem.quantity * Product.consumptionDays days
```

Consequências obrigatórias para esta task:

- a previsão é **lida**, nunca recalculada — nem na rota, nem no serviço, nem no
  navegador;
- a fórmula acima **não** pode aparecer nesta task em nenhuma camada;
- frescor é responsabilidade do banco: uma mudança de base já comitada tem a
  previsão recomputada antes que qualquer consumidor leia o commit, então o
  dashboard não precisa de invalidação própria e não pode inventar uma;
- `expectedRepurchaseAt` é nullable e permanece `NULL` em linhas legadas cujo
  valor não é representável (política explícita da TASK-09). O dashboard trata
  `NULL` como **não classificável**, nunca como vencida.

## Regra canônica de classificação

A classificação é feita sobre **dias do negócio**, não sobre instantes. Seja
`hoje` o dia do negócio corrente e `dia(x)` o dia do negócio de um instante `x`,
ambos no fuso definido por `lib/format/businessDate.ts`:

```text
vencida   := dia(expectedRepurchaseAt) <  hoje
hoje      := dia(expectedRepurchaseAt) == hoje
proximos  := hoje < dia(expectedRepurchaseAt) <= hoje + 7 dias
fora      := dia(expectedRepurchaseAt) >  hoje + 7 dias
nao_class := expectedRepurchaseAt IS NULL
```

Decisões de fronteira, explícitas para não ficarem a critério da implementação:

- a janela `proximos` **começa em `hoje + 1`**: `hoje` é um balde próprio e um
  item nunca aparece em dois baldes;
- a janela `proximos` **inclui `hoje + 7`** (limite superior fechado). "Próximos
  sete dias" são sete dias contados a partir de amanhã;
- `fora` e `nao_class` **não aparecem** no dashboard e não entram em nenhuma
  contagem de balde;
- a comparação é por dia do negócio, então um item previsto para hoje às 23:59 e
  outro para hoje às 00:01 estão ambos em `hoje`, independentemente da hora local
  de quem lê.

A regra deve existir em uma função reutilizável fora da camada visual, em
`lib/sales/repurchaseForecast.ts`. A rota, a página e qualquer teste consomem a
mesma função; não podem existir duas implementações independentes da
classificação.

## Fonte dos dados

Não existe hoje endpoint que devolva previsões de recompra entre clientes.
`GET /api/customers/[id]/sales` é por cliente (TASK-11) e `GET /api/sales` é o
contrato de registro de venda; nenhum dos dois serve a leitura transversal que o
SDD pede.

Esta task cria um endpoint de leitura dedicado:

```text
GET /api/repurchases
```

Contrato:

- **somente GET.** Qualquer outro método responde `405`;
- sem cache persistente; leitura de verdade de banco, como em `/api/products`;
- devolve apenas itens classificáveis dentro da janela (`vencida`, `hoje`,
  `proximos`), já com o balde resolvido pelo servidor;
- cada item carrega o necessário para o contato: identificação do cliente, do
  produto, a quantidade vendida, a data da venda e a previsão persistida;
- devolve também as contagens por balde, derivadas do mesmo conjunto retornado.

Forma da resposta:

```jsonc
{
  "generatedAt": "2026-08-23T18:00:00.000Z",
  "counts": { "overdue": 3, "today": 1, "upcoming": 7 },
  "items": [
    {
      "saleItemId": 42,
      "bucket": "overdue",
      "expectedRepurchaseAt": "2026-08-20T03:00:00.000Z",
      "quantity": 2,
      "sale": { "id": 17, "soldAt": "2026-07-01T03:00:00.000Z" },
      "customer": { "id": 5, "name": "Maria", "phone": "+5511999999999" },
      "product": { "id": 9, "name": "Shampoo", "unit": "un" }
    }
  ]
}
```

`counts` deve ser derivado do mesmo conjunto que produz `items`: um resumo que
possa divergir da lista é proibido.

## Consulta e índice

A consulta filtra `SaleItem.expectedRepurchaseAt` em uma janela limitada, entre
todos os itens de venda, e ordena por esse mesmo campo. Hoje `SaleItem` só tem
índices em `saleId` e `productId`, então a consulta seria um scan completo que
cresce com o histórico inteiro de vendas.

Esta task introduz **uma única alteração de schema**, aditiva:

```prisma
@@index([expectedRepurchaseAt])
```

Justificativa e limites:

- é um índice de leitura; não altera coluna, tipo, nulabilidade nem semântica;
- **não** toca a propriedade da derivação: os triggers da TASK-09 continuam
  donos do valor, e ARCH-01 permanece intacto;
- é a única migration desta task. Qualquer outra alteração de schema está fora
  de escopo e exige nova decisão de arquitetura.

O recorte da janela (`>= início do dia de hoje` e `<= fim do dia `hoje + 7``)
deve ser calculado em instantes UTC derivados do contrato de dia do negócio e
aplicado no banco, para que o filtro use o índice em vez de trazer todas as
linhas e filtrar em memória. Itens com `expectedRepurchaseAt IS NULL` são
excluídos pela própria consulta.

## Página e navegação

Criar a página em `/repurchases`. O texto visível permanece em português:
**Recompra** / **Recompras a contatar**.

O link **Recompra** deve ser adicionado a **todas** as telas que hoje têm `nav`
própria: `/` (clientes), `/products`, `/sales` e `/inventory`. São quatro, não
três: a TASK-13 acrescentou `/inventory` depois da TASK-11. Nenhum destino
existente pode ser removido.

## Conteúdo do dashboard

### Resumo

Três contadores, um por balde: vencidas, hoje, próximos sete dias. Cada contador
reflete exatamente o conjunto listado no seu balde.

### Lista

Os itens são agrupados por balde, na ordem `vencida` → `hoje` → `proximos`, e
cada item mostra pelo menos: nome do cliente, telefone quando houver, nome e
unidade do produto, quantidade, data da venda e data prevista de recompra.

Datas são renderizadas por `formatBusinessDate`. Nenhuma data é formatada com
`toLocaleDateString` cru nem com o fuso do navegador.

### Ordenação determinística

Dentro de cada balde: `expectedRepurchaseAt ASC`, desempate por `saleItemId ASC`.

O desempate é obrigatório porque `(saleId, productId)` não é único e duas linhas
podem ter exatamente a mesma previsão; sem ele a ordem entre elas fica a cargo do
plano de execução e a lista muda de posição entre leituras iguais.

## Estados de interface

- **carregando**: estado observável, sem falso empty state;
- **erro**: mensagem de erro e retry; nunca apresentado como "nenhuma recompra";
- **vazio**: quando os três baldes estão vazios, empty state próprio, não erro;
- **balde vazio**: um balde sem itens não é erro; ou o grupo é omitido, ou é
  mostrado com contagem zero. A escolha deve ser consistente entre os três.

## Responsividade e acessibilidade

Mobile-first. Sem rolagem horizontal do corpo da página em viewport estreito.
Landmarks, foco visível e alvos de toque de pelo menos 44px, no mesmo padrão já
validado por TASK-11 e TASK-13.

## Fronteiras de domínio

Esta task é consumidora de leitura. É **proibido**:

- recalcular a previsão em qualquer camada;
- escrever em `expectedRepurchaseAt`, `Sale`, `SaleItem`, `Product` ou `Customer`;
- criar um segundo caminho de mutação de estoque ou de registro de venda;
- reimplementar a regra de dia do negócio fora de `lib/format/businessDate.ts`;
- duplicar a regra de classificação entre rota, página e testes;
- alterar o comportamento visível de `/`, `/products`, `/sales` ou `/inventory`
  além do acréscimo do link de navegação;
- refatorar TASK-09, ARCH-02 ou ARCH-03 a pretexto desta task.

## Casos de borda e falha

1. `expectedRepurchaseAt` `NULL` → item não aparece em nenhum balde e não entra
   em nenhuma contagem.
2. Previsão exatamente em `hoje + 7` → entra em `proximos`.
3. Previsão exatamente em `hoje + 8` → não aparece.
4. Previsão exatamente em `hoje - 1` → `vencida`.
5. Previsão hoje às 00:00 e hoje às 23:59 → ambas em `hoje`.
6. Venda retroagida cruzando virada de horário de verão → limitação L4 herdada:
   a previsão por duração fixa pode cair no dia da própria venda. O dashboard
   **exibe o que está persistido** e não corrige; a limitação é registrada, não
   contornada.
7. Cliente sem telefone → item aparece normalmente, telefone renderizado como
   ausente, sem quebrar o layout.
8. Banco indisponível → `500` com corpo de erro; a página mostra erro e retry.
9. Método diferente de GET em `/api/repurchases` → `405`.
10. Múltiplos itens da mesma venda com previsões diferentes → cada item é uma
    linha própria, conforme "vendas com vários produtos geram previsões por item".

## Estratégia de testes

**Unitário da classificação** (`lib/sales/repurchaseForecast.ts`), sem banco:
cobre os baldes, as duas fronteiras (`hoje + 7` dentro, `hoje + 8` fora),
`hoje - 1`, `NULL`, ordenação e desempate por `saleItemId`, e a coerência entre
`counts` e `items`.

**Integração com PostgreSQL**, no padrão dos harnesses existentes:

- itens semeados em cada balde aparecem no balde correto;
- uma venda registrada pelo caminho da TASK-08/09 aparece no dashboard com a
  previsão que o banco persistiu, sem que a task calcule nada;
- alterar `Sale.soldAt`, `SaleItem.quantity`, `SaleItem.productId` ou
  `Product.consumptionDays` muda o balde na leitura seguinte — prova de frescor
  pelo trigger, não por recálculo;
- linha legada com `expectedRepurchaseAt NULL` não aparece;
- `/api/repurchases` responde `405` para métodos não-GET.

**Playwright efêmero**: os três baldes com conteúdo, empty state, erro com retry,
carregamento sem falso vazio, navegação para `/repurchases` a partir de `/`,
`/products`, `/sales` e `/inventory`, ausência de rolagem horizontal em viewport
móvel, e uma venda confirmada aparecendo na próxima leitura do dashboard.

**Guarda de fronteira**: um teste de código-fonte, no padrão de
`scripts/task-13-source-check.mjs`, que falha se a fórmula da previsão ou uma
escrita em `expectedRepurchaseAt` aparecer nos arquivos desta task.

## Critérios de aceite

AC1. Item com `dia(expectedRepurchaseAt) < hoje` é classificado como vencida.

AC2. Item com `dia(expectedRepurchaseAt) == hoje` é classificado como hoje.

AC3. Item com `hoje < dia(expectedRepurchaseAt) <= hoje + 7` é classificado como próximos sete dias.

AC4. Item com `dia(expectedRepurchaseAt) == hoje + 7` aparece; com `hoje + 8` não aparece.

AC5. Item com `expectedRepurchaseAt IS NULL` não aparece em nenhum balde nem em nenhuma contagem.

AC6. Nenhum item aparece em mais de um balde.

AC7. As contagens correspondem exatamente aos conjuntos listados.

AC8. A ordem dentro de cada balde é `expectedRepurchaseAt ASC`, desempate `saleItemId ASC`.

AC9. Uma venda confirmada aparece no dashboard na próxima leitura, com a previsão realmente persistida pelo banco.

AC10. Alterar `soldAt`, `quantity`, `productId` ou `consumptionDays` reclassifica o item na leitura seguinte, sem qualquer recálculo nesta task.

AC11. A classificação existe em uma única função reutilizável fora da UI.

AC12. A fórmula da previsão não aparece em nenhuma camada desta task, e nada nesta task escreve em `expectedRepurchaseAt`.

AC13. `/repurchases` é alcançável pela navegação a partir de `/`, `/products`, `/sales` e `/inventory`, sem remover destinos existentes.

AC14. Falha de carregamento produz erro e retry, nunca falso empty state; zero recompras produz empty state próprio.

AC15. Datas são exibidas pelo contrato de dia do negócio, não pelo fuso do navegador.

AC16. `/api/repurchases` aceita apenas GET e responde `405` para os demais métodos.

AC17. A única alteração de schema é o índice aditivo em `expectedRepurchaseAt`.

## Validação determinística

Gates obrigatórios, todos verdes: `db:generate`, `db:validate`, `db:migrate`,
`db:health`, `test:migration-compat`, a suíte `npm test` incluindo o novo teste
de classificação e a nova guarda de fronteira, `test:product-api`,
`test:customer-api`, `test:loop-controller`, `lint`, `typecheck`, `build`,
`git diff --check` e varredura de segredos.

Playwright efêmero com `retries 0`, artefatos removidos após a execução conforme
`docs/operations/PLAYWRIGHT-EPHEMERAL.md`.

## Definition of Done

- AC1 a AC17 provados por teste, não por inspeção;
- todos os gates determinísticos verdes no HEAD exato do PR;
- revisão independente publicada para esse HEAD exato, sem findings em aberto;
- revisão publicada antes do merge;
- evidência em `docs/evidence/TASK-12-validation.md`;
- STATE, HANDOFF, ROADMAP e LOOP-REGISTER reconciliados;
- limitação L4 registrada explicitamente como residual aceito.

## Não escopo

Contato automático, WhatsApp, mensagens, histórico de contato, marcação de
"já contatado", filtros por cliente ou produto, paginação, exportação,
priorização por valor, e qualquer alteração no cálculo ou na propriedade da
previsão.

## Riscos conhecidos

- **L4 (herdado)**: previsão por duração fixa pode cair no dia da própria venda
  em venda retroagida cruzando virada de horário de verão. Residual aceito,
  coberto por teste que fixa o comportamento.
- **Fronteira de dia**: classificação por dia do negócio depende de
  `BUSINESS_TIME_ZONE`. Uma mudança nessa constante muda baldes na fronteira.
  Mitigado por usar o contrato compartilhado e por testes de fronteira.
- **Crescimento da janela**: a consulta é limitada a oito dias à frente mas não
  tem limite para trás, então o balde de vencidas cresce indefinidamente com o
  histórico. Aceito no MVP; paginação está fora de escopo e o índice mantém o
  filtro eficiente.

## Assumptions explícitas

- **A1**: "próximos sete dias" exclui hoje e inclui `hoje + 7`.
- **A2**: o fuso do negócio é o já assumido em A3 da TASK-11
  (`America/Sao_Paulo`), consumido por `lib/format/businessDate.ts`.
- **A3**: itens fora da janela de oito dias não interessam ao dashboard e não
  são retornados pela API.
- **A4**: o dashboard lista itens de venda, não clientes agregados; um cliente
  com três recompras aparece três vezes.
