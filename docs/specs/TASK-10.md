# TASK-10 Spec — Interface de registro de venda

Status: CONCURRENCY_DECIDED_IMPLEMENTING
Branch: `feat/TASK-10-sale-registration-ui`
Baseline: `7bf2dd0df9c873576bdb17c81c92e819f4587822`
Source: `docs/product/PROJECT-SDD.md` + `docs/roadmap/ROADMAP.md`
Depends on: TASK-04 (interface Customer), TASK-06 (interface Product), TASK-09 (previsão de recompra)

## Outcome

Permitir registrar uma venda pela interface: escolher o cliente, adicionar um ou
mais produtos com quantidade, confirmar, e ver o resultado refletido em estoque e
previsão de recompra. Fluxo mobile-first.

## In scope

- tela de registro de venda com seleção de cliente e de produtos;
- múltiplos itens por venda, com quantidade por item;
- API de venda que persista `Sale` + `SaleItem` de forma atômica;
- feedback de erro legível para as regras que já existem no banco
  (estoque insuficiente, venda sem itens, quantidade não positiva);
- estados de carregamento, vazio e erro;
- validação mobile-first com Playwright efêmero.

## Out of scope

- histórico do cliente (TASK-11);
- dashboard de recompra (TASK-12);
- dashboard de estoque (TASK-13);
- edição e cancelamento de venda já registrada, salvo o mínimo que o fluxo exigir;
- decidir o ARCH-01 (previsão persistida vs calculada) — este spec não depende do
  desfecho e não deve antecipá-lo.

## Invariantes herdadas (não reimplementar, não contornar)

Estas regras já são garantidas no banco pelas TASK-07/08/09 e a interface deve
apenas respeitá-las e reportá-las:

- uma venda confirmada tem pelo menos um item;
- quantidade é positiva;
- confirmar a venda reduz o estoque atomicamente e nunca o deixa negativo;
- `expectedRepurchaseAt` é derivado: é calculado no banco e reescrito se alguém
  tentar gravá-lo diretamente. A interface **não** envia esse campo;
- `Sale.id` e `Product.id` são imutáveis.

## Contrato de concorrência (obrigatório, decidir antes de implementar)

A TASK-09 deixou um residual aceito e registrado: a ordem de locks da malha de
triggers é uma garantia **por linha afetada**, não por statement nem por
transação. Um statement ou uma transação que escreva vários `SaleItem` pode,
portanto, travar uma `Sale` para uma linha e só então alcançar um `Product` para a
próxima, e uma exclusão concorrente do mesmo produto/venda fecha um ciclo que o
PostgreSQL aborta com `40P01` retentável.

Nenhum caminho atual da aplicação faz isso. A TASK-10 é o primeiro que pode fazer,
porque uma venda com vários itens é o caso normal.

**Decisão registrada antes da implementação: adotar A e B juntas.** A sozinha
evita a forma perigosa nos caminhos que controlamos; B cobre o que não
controlamos, porque a exclusão concorrente de itens continua sendo uma operação
legal do banco e pode fechar um ciclo mesmo com a forma segura.

### Estratégia A — forma de mutação segura (ADOTADA)

Forma exata emitida pelo registro de venda:

1. abrir uma transação interativa única;
2. criar a `Sale` sem itens aninhados;
3. ordenar os itens por `productId` crescente antes de persistir;
4. inserir **um `SaleItem` por statement**, em sequência, dentro da mesma
   transação — nunca `createMany` nem `create` aninhado, que emitem um statement
   multi-linha;
5. a transação inteira é atômica: qualquer falha aborta a venda completa;
6. `expectedRepurchaseAt` nunca é enviado nem calculado na aplicação.

A ordem por `productId` crescente é a mesma ordem que o trigger de previsão usa
para travar linhas de `Product`, então duas vendas concorrentes que compartilham
produtos os requisitam na mesma ordem relativa.

**Garantia estrutural, não convenção.** A regra vive em um único ponto,
`lib/sales/registerSale.ts`, que é o único caminho autorizado a persistir
`Sale`/`SaleItem`. Ele recebe os itens já normalizados, ordena internamente e
emite os inserts em laço. A rota de API não monta escrita própria: ela valida a
entrada e delega.

**O que impede regressão silenciosa.** O harness de concorrência afirma a forma
emitida, não apenas o resultado. Ele assina o evento `query` do Prisma, coleta os
statements `INSERT INTO "SaleItem"` realmente enviados ao PostgreSQL e exige um
statement por item, na ordem crescente de `productId`. Trocar o laço por
`createMany` derruba a contagem para um único statement e quebra o teste.

Duplicidade de produto na mesma venda é normalizada **antes** da persistência:
seleções repetidas do mesmo `productId` são somadas em um único item, o que
mantém um item por produto, preserva a quantidade total pretendida e evita duas
linhas concorrendo pelo mesmo `Product` dentro da mesma transação.

A soma é validada no mesmo passo: duas linhas podem ser individualmente válidas
e mesmo assim somar acima do range `INTEGER`, então o total é verificado com
`Number.isSafeInteger` e contra `2147483647` antes de abrir a transação, virando
**400** em vez de um erro genérico de banco.

### Estratégia B — retry limitado (ADOTADA)

Política exata:

- **máximo de 3 tentativas no total** (a primeira mais 2 repetições);
- retenta **apenas** `40P01` (deadlock detectado) e `40001` (falha de
  serialização); qualquer outro erro falha imediatamente;
- retenta também o código normalizado do Prisma **`P2034`**: uma escrita tipada
  que sofre um `40P01`/`40001` real chega com esse código e **sem** o SQLSTATE,
  então classificar só por SQLSTATE desativaria silenciosamente o retry
  justamente no caminho que ele existe para proteger;
- a transação **inteira** é refeita do zero a cada tentativa, incluindo a criação
  da `Sale`. Nada é continuado a partir de estado parcial, e uma tentativa
  abortada não deixa `Sale` órfã porque o rollback do PostgreSQL desfaz tudo;
- espera limitada entre tentativas: 20 ms e depois 40 ms (backoff linear curto),
  sem jitter aleatório para manter o teste determinístico e sem laço ilimitado;
- ao esgotar as tentativas, propaga um erro dedicado
  (`SaleConcurrencyError`) que a API traduz em **HTTP 503** com mensagem legível
  pedindo nova tentativa — falha visível, nunca silenciosa;
- o SQLSTATE original é preservado no erro para diagnóstico e para permitir
  distinguir falha de concorrência de erro de domínio.

**Distinção entre concorrência e invariante de domínio.** As invariantes das
TASK-07/08/09 chegam como erros do PostgreSQL com SQLSTATE próprio — `23514`
para `CHECK` (estoque negativo, quantidade não positiva, venda sem itens) e
`23503` para chave estrangeira — ou, pela escrita tipada, como o código
`P2003` do Prisma, que também é tratado como invariante. Esses **não** são retentáveis: são resposta
determinística do domínio e viram **HTTP 409** com mensagem específica. Retentar
um deles apenas repetiria a mesma falha três vezes e mascararia a causa.

### Mapa de erros da API

| Origem | SQLSTATE | HTTP | Comportamento |
| --- | --- | --- | --- |
| entrada inválida, inclusive total duplicado fora do range | — | 400 | falha imediata, mensagem de validação |
| cliente ou produto inexistente | `23503` / `P2003` | 409 | falha imediata |
| invariante de domínio (estoque negativo, quantidade, venda sem itens) | `23514` | 409 | falha imediata, mensagem específica |
| deadlock | `40P01` / `P2034` | 503 após 3 tentativas | retenta a transação inteira |
| falha de serialização | `40001` | 503 após 3 tentativas | retenta a transação inteira |
| indisponibilidade/erro inesperado | outros | 503 | falha imediata |

### Regras que valem para qualquer estratégia

- **Não engolir erros de banco.** Um erro não retentável, ou o esgotamento das
  tentativas, deve falhar de forma visível e ser reportado ao usuário; nada de
  `catch` silencioso, e nada de transformar falha em venda parcialmente
  registrada.
- Esgotar o retry é um resultado legítimo e deve produzir mensagem clara.
- A escolha deve ser **provada com um teste de concorrência**, no mesmo padrão
  determinístico das TASK-07/08/09: duas transações concorrentes reproduzindo o
  cenário e exigindo o desfecho contratado, contra PostgreSQL real, sem `sleep`
  como sincronização.

## Done when

- fluxo de registro de venda funciona ponta a ponta pela interface;
- venda multi-item persiste todos os itens atomicamente;
- estoque e previsão refletem a venda;
- erros das invariantes herdadas aparecem de forma legível na interface;
- a estratégia de concorrência está escrita nesta seção **antes** da
  implementação e provada por teste de concorrência determinístico;
- nenhum erro de banco é silenciosamente engolido;
- Validate completo verde;
- Playwright efêmero mobile-first aprovado (obrigatório nesta task: há mudança de
  interface, ao contrário da TASK-09);
- revisão independente sem findings bloqueantes no HEAD exato;
- STATE/HANDOFF/evidence reconciliados antes do merge.
