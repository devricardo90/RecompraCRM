# TASK-12 Spec — Dashboard de recompra

Status: SPEC_REVIEW_ROUND_1_FIXED_OWNER-01_DECIDED
Source: Google Docs `Fonte da Verdade - Recompra CRM` + `docs/product/PROJECT-SDD.md` + `docs/roadmap/ROADMAP.md` + `docs/architecture/ARCH-01-decision.md`
Depends on: TASK-09, TASK-11, ARCH-01
Baseline: `4dbade2a88fa8bdff2c216ee4ec73006886c7872` (`main`, Rick Loop v1.4)
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

### Instante de referência

Toda a resposta deriva de **um único instante capturado no início da requisição**.
Esse instante é o `generatedAt` emitido, e dele saem: `hoje`, os limites UTC do
filtro SQL, e o balde de cada item.

Ler o relógio mais de uma vez dentro da mesma requisição é proibido. Uma
requisição que atravessa a meia-noite do negócio poderia consultar pela fronteira
do dia antigo e classificar pelo dia novo, omitindo o sétimo dia recém-elegível;
com um instante único isso não pode acontecer.

### Baldes

A classificação é feita sobre **dias do negócio**, não sobre instantes. Seja
`hoje` o dia do negócio do instante de referência e `dia(x)` o dia do negócio de
um instante `x`, ambos no fuso definido por `lib/format/businessDate.ts`:

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
`lib/sales/repurchaseForecast.ts`.

**A classificação acontece uma única vez, no servidor.** A rota e os testes
consomem essa função; a página **não** classifica e **não** reclassifica: ela
renderiza o balde que veio na resposta.

Sem isso, uma resposta buscada pouco antes da meia-noite do negócio e renderizada
logo depois seria reclassificada pelo dia novo enquanto `counts` ainda descreve
os baldes do dia anterior, e o resumo passaria a divergir dos grupos exibidos. O
par `items`/`counts` é um retrato de um instante, e é renderizado como tal.

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
      // phone tem tipo string | null e a chave está sempre presente
      "customer": { "id": 5, "name": "Maria", "phone": "+5511999999999" },
      "product": { "id": 9, "name": "Shampoo", "unit": "un" }
    }
  ]
}
```

`counts` deve ser derivado do mesmo conjunto que produz `items`: um resumo que
possa divergir da lista é proibido.

`customer.phone` é declarado `string | null`: a chave está **sempre presente** e
vale `null` quando o cliente não tem telefone. Campo omitido e campo nulo geram
tipos de API diferentes e fariam rota e UI divergirem; a representação exata é
fixada aqui e coberta por teste.

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

O recorte é **aberto para trás e fechado para a frente**:

```text
expectedRepurchaseAt IS NOT NULL
AND expectedRepurchaseAt <= fim do dia (hoje + 7)
```

Não há limite inferior. Um limite inferior de "início do dia de hoje" excluiria
exatamente o conjunto `vencida` e tornaria AC1 impossível de satisfazer; o balde
de vencidas existe justamente para o que já passou. O limite de oito dias vale
**só para a frente**.

O limite superior é calculado em instantes UTC derivados do instante de
referência pelo contrato de dia do negócio, e aplicado no banco, para que o
filtro use o índice em vez de trazer todas as linhas e filtrar em memória. Itens
com `expectedRepurchaseAt IS NULL` são excluídos pela própria consulta.

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

AC18. Um item vencido há muito tempo, muito além de qualquer janela para a frente, é retornado e classificado como vencida; a consulta não tem limite inferior.

AC19. Toda a resposta deriva de um único instante de referência, emitido como `generatedAt`: `hoje`, os limites UTC do filtro e o balde de cada item vêm dele.

AC20. A página renderiza o balde recebido e não reclassifica; `counts` e os grupos exibidos não podem divergir, mesmo que a renderização ocorra depois da virada do dia do negócio.

AC21. `customer.phone` está sempre presente na resposta com tipo `string | null`, e vale `null` para cliente sem telefone.

AC22. Um cliente com três previsões produz três linhas independentes, cada uma com a sua data e o seu balde; não existe agregação por cliente nem data representativa, e as contagens contam itens.

## Validação determinística

Gates obrigatórios, todos verdes: `db:generate`, `db:validate`, `db:migrate`,
`db:health`, `test:migration-compat`, a suíte `npm test` incluindo o novo teste
de classificação e a nova guarda de fronteira, `test:product-api`,
`test:customer-api`, `test:loop-controller`, `lint`, `typecheck`, `build`,
`git diff --check` e varredura de segredos.

Playwright efêmero com `retries 0`, artefatos removidos após a execução conforme
`docs/operations/PLAYWRIGHT-EPHEMERAL.md`.

## Definition of Done

- AC1 a AC22 provados por teste, não por inspeção;
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

## Decisão de dono — OWNER-01 (RESOLVIDA)

**OWNER-01 — granularidade das linhas do dashboard. Decidida: Opção A.**

O SDD estabelece que previsões são geradas **por item de venda**. Ele não diz
como o dashboard de contato apresenta isso. As duas leituras são defensáveis e
produzem produtos diferentes:

- **Opção A — uma linha por item de venda.** Um cliente com três produtos
  previstos aparece três vezes, cada uma com a sua data e o seu balde.
- **Opção B — uma linha por cliente, agregando produtos.** Um cliente aparece
  uma vez, com os produtos dentro.

Isto não é detalhe de implementação: muda a cardinalidade da lista, as contagens
dos baldes e o fluxo de contato da usuária.

Critérios: o objetivo declarado do SDD é "identificar clientes que devem ser
contatados", o que puxa para B; mas cada item tem a sua própria data e itens do
mesmo cliente podem cair em baldes diferentes, o que obrigaria B a escolher uma
data representativa ou a repetir o cliente entre baldes — reintroduzindo A por
outro caminho.

**Decisão do dono: Opção A — uma linha de dashboard por item de venda.**

O invariante a preservar é:

```text
item de venda -> previsão -> data da previsão -> balde
```

Consequências vinculantes para esta task:

- **proibido** introduzir agregação por cliente;
- **proibido** introduzir regra de data representativa;
- um cliente com três previsões produz três linhas, cada uma com a sua data e o
  seu balde;
- as contagens dos baldes contam itens, não clientes.

Agrupamento por cliente pode ser implementado depois como camada de
apresentação sobre este mesmo contrato de previsão por item, sem alterar o
contrato de origem. Isso está fora do escopo da TASK-12.

A decisão desbloqueia a implementação: nada mais nesta spec depende dela.

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
- **A3**: o limite de oito dias vale apenas para a frente. Itens previstos para
  depois de `hoje + 7` não são retornados; itens vencidos são retornados sem
  limite inferior, por mais antigos que sejam.
- **A4**: uma linha por item de venda. Decidido pelo dono em OWNER-01, Opção A;
  não é mais uma suposição de engenharia.
