# TASK-13 Spec — Dashboard de estoque

Status: SPEC_DRAFT_ROUND_0_PENDING_REVIEW
Source: Google Docs `Fonte da Verdade - Recompra CRM` + `docs/product/PROJECT-SDD.md` + `docs/roadmap/ROADMAP.md`
Depends on: TASK-06, TASK-08
Baseline: `2995589c88ea7ab46781b59ba273b440eb2eebdd` (`main`)
Branch: `feat/TASK-13-stock-dashboard`

## Gate de fonte da verdade

A fonte primária do Google Docs foi lida antes desta spec. Não há contradição com o SDD do repositório para esta task:

- RB-12: produto com estoque **igual ou abaixo** do estoque mínimo deve aparecer como alerta;
- TASK-13: resultado esperado = produtos abaixo ou iguais ao estoque mínimo;
- TASK-13: aceite = alertas atualizam após vendas.

Portanto a task está `READY` do ponto de vista de produto. ARCH-01 e ARCH-02 não são dependências da TASK-13 e não autorizam refatoração nesta task.

## Objetivo

Entregar uma visão mobile-first, somente leitura, que mostre imediatamente quais produtos precisam de atenção de estoque usando a verdade atual persistida em `Product.currentStock` e `Product.minimumStock`.

A task **não** cria uma segunda regra de estoque, não altera estoque e não recalcula venda. A mutação de estoque continua pertencendo à transação da TASK-08.

## Regra canônica de alerta

Um produto está em alerta se, e somente se:

```text
currentStock <= minimumStock
```

Consequências obrigatórias:

- `currentStock == minimumStock` **é alerta**;
- `currentStock < minimumStock` **é alerta**;
- `currentStock > minimumStock` **não é alerta**;
- estoque negativo continua impossível pelo contrato de banco da TASK-08; o dashboard não cria tratamento alternativo para esse estado inválido.

A regra deve existir em uma função reutilizável fora da camada visual. A UI de `/products` e o novo dashboard não devem manter duas implementações independentes de `currentStock <= minimumStock`.

## Fonte dos dados

Preferência canônica desta task: reutilizar `GET /api/products` e a persistência já entregue pelas TASK-05/06.

Motivos:

- a API já retorna `id`, `name`, `unit`, `currentStock`, `minimumStock` e demais campos necessários;
- criar um segundo endpoint apenas para aplicar um filtro simples duplicaria contrato sem requisito do SDD;
- a task é um consumidor de leitura, não um novo domínio.

A leitura deve usar dados atuais, sem cache que possa esconder uma venda recém-confirmada. Se a implementação atual da API já usa verdade de banco sem cache persistente, preserve esse comportamento.

## Página e navegação

Criar uma página dedicada de dashboard de estoque em `/inventory`.

A página deve ser acessível pela navegação principal das telas relevantes sem
remover os destinos existentes de clientes, produtos e registro de venda.

"Telas relevantes" é enumerado, não deixado a critério: `/` (clientes),
`/products` e `/sales`. Cada uma dessas telas tem hoje a sua própria `nav`
independente, então o link **Estoque** precisa ser adicionado nas três — do
contrário `/inventory` fica alcançável apenas por URL digitada, o que a AC13
proíbe.

A rota `/inventory` é uma convenção de implementação para manter o padrão atual de rotas em inglês (`/products`, `/sales`, `/customers`). O texto visível ao usuário permanece em português: **Estoque** / **Alertas de estoque**.

## Conteúdo do dashboard

### Resumo

Mostrar pelo menos:

- quantidade total de produtos em alerta;
- estado textual que deixe claro que o critério é estoque atual `<=` estoque mínimo.

### Lista de alertas

Cada item deve mostrar:

- nome do produto;
- unidade;
- estoque atual;
- estoque mínimo;
- indicação visual/textual de estoque baixo.

Não mostrar produtos acima do mínimo na lista de alertas.

### Ordenação determinística

Ordenar alertas por urgência usando:

1. `currentStock - minimumStock ASC` (maior déficit primeiro);
2. `id ASC` como desempate total.

Não usar ordem de retorno do banco como contrato implícito.

## Semântica de “atualizam após vendas”

O aceite significa que, após uma venda confirmada reduzir o estoque pela transação canônica da TASK-08, a próxima leitura do dashboard deve refletir o novo valor e a nova classificação.

Prova mínima obrigatória:

1. produto começa acima do mínimo e não aparece no dashboard;
2. uma venda confirmada reduz `currentStock` até o mínimo ou abaixo;
3. ao abrir/recarregar o dashboard depois da confirmação, o produto aparece como alerta com o estoque persistido correto.

Não há requisito de atualização em tempo real enquanto a página permanece aberta em outra aba. WebSocket, SSE, polling contínuo e sincronização cross-tab estão fora do MVP e fora desta task.

## Estados de interface

A página deve distinguir claramente:

- **carregando**: skeleton/estado de progresso sem falso “zero alertas”;
- **erro**: mensagem legível + ação `Tentar novamente`;
- **sem alertas**: estado positivo próprio, por exemplo “Nenhum produto precisa de reposição agora”;
- **com alertas**: resumo + lista determinística.

Um erro de rede/banco nunca pode ser apresentado como lista vazia.

## Responsividade e acessibilidade

- mobile-first;
- sem overflow horizontal em `390x844`;
- conteúdo e ações principais acessíveis em `844x390`;
- desktop validado em `1440x900`;
- foco visível em links/botões;
- status não pode depender apenas de cor;
- títulos e landmarks devem permitir navegação por leitor de tela;
- touch targets relevantes com dimensão coerente com as telas já entregues.

## Fronteiras de domínio

A TASK-13 não pode:

- escrever `Product.currentStock`;
- alterar triggers ou constraints da TASK-08;
- criar nova forma de registrar venda;
- recalcular estoque no cliente;
- recalcular previsão de recompra;
- modificar `Sale`, `SaleItem` ou `expectedRepurchaseAt`;
- resolver ARCH-01 ou ARCH-02 incidentalmente.

Se algum desses pontos se mostrar necessário para exibir o dashboard, isso é sinal de scope drift e deve bloquear a implementação até a spec ser corrigida.

## Banco e migrations

Esperado: **nenhuma migration** e nenhuma alteração de schema.

A informação necessária já existe no modelo Product e é mantida pela transação de venda/estoque. Uma migration nesta task exige justificativa nova e revisão de spec antes de ser criada.

## Critérios de aceite

AC1. Produto com `currentStock < minimumStock` aparece como alerta.

AC2. Produto com `currentStock == minimumStock` aparece como alerta.

AC3. Produto com `currentStock > minimumStock` não aparece na lista de alertas.

AC4. A contagem de alertas corresponde exatamente ao conjunto filtrado pela regra canônica.

AC5. A ordem é determinística por déficit (`currentStock - minimumStock ASC`) e depois `id ASC`.

AC6. Uma venda confirmada que cruza o limiar de estoque faz o produto aparecer na próxima leitura do dashboard, com o valor de estoque realmente persistido.

AC7. Falha de carregamento produz estado de erro e retry; não produz falso empty state.

AC8. Zero alertas produz empty state próprio e não mensagem de erro.

AC9. A regra de low-stock é compartilhada/reutilizável fora da UI, sem duas definições independentes entre `/products` e `/inventory`.

AC9.1. A extração não altera o comportamento visível de `/products`: o selo
"Estoque baixo" e o contador continuam usando o mesmo predicado, inclusive no
ponto de igualdade `currentStock == minimumStock`, e isso é provado por cenário
Playwright próprio — os harnesses existentes não renderizam essa tela.

AC10. Mobile `390x844`, landscape `844x390` e desktop `1440x900` não apresentam overflow horizontal nem ação principal inacessível.

AC13. `/inventory` é alcançável pela navegação visível de `/`, `/products` e
`/sales`, e nenhuma dessas telas perde os destinos que já expunha.

AC14. Durante o carregamento a página mostra progresso e **não** mostra "zero
alertas" nem o empty state. O estado de carregamento é observável com a resposta
atrasada, não apenas inferido do código.

AC11. Nenhuma escrita de estoque, venda ou previsão é introduzida pelo dashboard.

AC12. Schema/migrations permanecem inalterados.

## Validação determinística

Antes de abrir a implementação para merge:

- baseline/CI verde;
- `npm run db:generate`;
- `npm run db:validate`;
- migrations existentes aplicadas em PostgreSQL descartável;
- harness de Product e Sale/Stock continua verde;
- teste direcionado da projeção de alertas cobre AC1–AC6 e ordenação;
- Product API integration continua verde;
- `npm run test:loop-controller`;
- lint;
- typecheck;
- build;
- `git diff --check`;
- scan de escopo/segredos;
- Playwright efêmero obrigatório por ser mudança de UI.

## Playwright efêmero

Cenários mínimos, sem persistir screenshot/trace/video após sucesso:

1. **desktop `1440x900`** — lista com produto abaixo, igual e acima do mínimo;
   apenas os dois primeiros aparecem; contagem correta; **e a ordem renderizada é
   asserida**, não só a pertinência. As fixtures são construídas para que a ordem
   de `GET /api/products` (`updatedAt DESC, name ASC`) **conflite** com a ordem por
   urgência: sem isso, uma implementação que renderize o array da API na ordem em
   que ele chega passaria com a AC5 quebrada. A asserção é sobre a sequência
   visível, por déficit crescente e depois `id`;
2. **mobile `390x844`** — lista de alertas legível, navegação acessível e sem overflow horizontal;
3. **landscape `844x390`** — resumo e primeiro alerta acessíveis sem corte de ação essencial;
4. **empty state** — nenhum produto em alerta;
5. **error/retry** — falha controlada de leitura mostra erro, retry recupera;
6. **venda → alerta** — produto começa acima do mínimo, venda é registrada pelo fluxo canônico, dashboard é aberto/recarregado e passa a mostrar o produto com o estoque reduzido;
7. **carregando com resposta atrasada** — a leitura de produtos é atrasada de
   forma controlada; enquanto está pendente, o cenário exige progresso visível e
   exige a **ausência** de "zero alertas" e do empty state; depois de resolver, a
   lista aparece. Sem este cenário, uma implementação que mostrasse falso "zero
   alertas" durante todo carregamento passaria em todos os outros, porque todos
   esperam a resposta final;
8. **entrada pela navegação** — o cenário chega a `/inventory` clicando no link
   **Estoque** a partir de `/products`, e confirma que `/`, `/products` e `/sales`
   continuam expondo os destinos que já tinham. Abrir `/inventory` por URL direta
   não prova a AC13: a rota poderia estar inacessível pela interface com todos os
   gates verdes;
9. **`/products` não regride** — a AC9 obriga extrair `isLowStock` de
   `ProductWorkspace`, então `/products` muda por construção. Nenhum outro
   cenário abre essa tela, e os harnesses de Product e Sale/Stock não renderizam
   UI: o selo "Estoque baixo" e o contador da TASK-06 poderiam quebrar com todos
   os gates verdes. O cenário abre `/products` com produtos abaixo, **igual** e
   acima do mínimo e exige selo exatamente nos dois primeiros e contador igual a
   `2`, provando o mesmo predicado compartilhado no ponto de igualdade;
10. console sem erro crítico.

Retry do Playwright deve ser `0`. Um cenário que só passa com retry é `FLAKY` e não libera a task.

## Não escopo

- previsão de recompra ou dashboard de recompra (TASK-12);
- compra/reposição de estoque;
- fornecedores;
- sugestão automática de quantidade para comprar;
- notificações push/email/WhatsApp;
- filtros avançados, exportação ou relatório financeiro;
- atualização realtime/polling;
- autenticação/permissões;
- mudanças de arquitetura de data/hora ou forecast.

## Riscos conhecidos

R1. **Duplicação da regra de alerta** — já existe `isLowStock` na UI de produtos. Mitigação: extrair/reutilizar uma função única fora da camada visual.

R1.2. **Gate verde que não observa nada** — três requisitos desta spec (ordem
renderizada, estado de carregando e alcançabilidade por navegação) podem ficar
quebrados com todos os gates verdes, porque nenhum cenário os observava. É a
mesma classe de defeito que a TASK-10 teve quando o harness exercitava uma cópia
da política em vez da produção. Mitigação: cada um ganhou cenário próprio com
asserção sobre o comportamento observável, não sobre a existência do código.

R1.1. **Regressão silenciosa em `/products` durante a extração** — mover a regra
altera uma tela entregue pela TASK-06 que nenhum gate atual observa. Mitigação:
cenário Playwright dedicado a `/products` (item 7), exigido antes do merge.

R2. **Falso freshness** — cache pode fazer o dashboard parecer desatualizado após venda. Mitigação: leitura atual sem cache persistente e teste venda → próxima leitura.

R3. **Scope creep para reposição** — “dashboard de estoque” pode virar gestão de compras. Mitigação: esta task é somente alerta/leitura.

R4. **Erro confundido com zero alertas** — mitigação: estados de erro e vazio distintos e cobertos por Playwright.

## Assumptions explícitas

A1. `/inventory` é a rota escolhida para o dashboard porque as rotas atuais são nomeadas em inglês. O SDD define a função, não a URL.

A2. “Atualiza após vendas” significa consistência na próxima leitura após a transação confirmada. Realtime enquanto a tela permanece aberta não é requisito do MVP.

A3. Não é necessário um novo endpoint de API enquanto `GET /api/products` continuar fornecendo todos os campos e refletindo a verdade atual do banco.

Estas assumptions são locais à TASK-13 e podem ser alteradas durante revisão da spec se houver evidência de repositório que as contradiga.
