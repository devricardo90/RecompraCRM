# TASK-14 Spec — Hardening do MVP

Status: SPEC_IN_REVIEW
Source: `docs/product/PROJECT-SDD.md` + `docs/roadmap/ROADMAP.md` + `docs/architecture/ARCH-02-decision.md`
Depends on: TASK-01..TASK-13
Baseline: `51bfacf5e809c937de212a463f15a2c1d454ac81` (`main`)
Branch: `docs/TASK-14-spec` (spec), implementação em branch própria

## Gate de fonte da verdade

O roadmap define a task inteira em uma linha:

> done_when: erros, loading, empty states, acessibilidade e responsividade sem bloqueios.

O SDD não acrescenta requisito de interface além de "datas exibidas no fuso do
negócio", já satisfeito por `lib/format/businessDate.ts`.

ARCH-02 está `RESOLVED` na Opção A e é dependência satisfeita. ARCH-03
permanece aberto, é não bloqueante e **não** autoriza refatoração aqui.

## Objetivo

Levar as seis telas existentes ao mesmo piso de qualidade e **tornar esse piso
verificável**, para que não dependa de inspeção humana nem se degrade em telas
futuras.

Esta task não adiciona funcionalidade, não altera regra de domínio, não toca
schema e não cria rota nova.

## Escopo: as seis telas

| Rota | Componente |
| --- | --- |
| `/` | `app/customers/CustomerWorkspace.tsx` |
| `/products` | `app/products/ProductWorkspace.tsx` |
| `/sales` | `app/sales/SaleWorkspace.tsx` |
| `/inventory` | `app/inventory/InventoryWorkspace.tsx` |
| `/repurchases` | `app/repurchases/RepurchaseWorkspace.tsx` |
| `/customers/[id]/history` | `app/customers/[id]/history/CustomerHistoryWorkspace.tsx` |

A lista é fechada e enumerada de propósito: "todas as telas" já produziu, na
TASK-13, um link de navegação faltando porque a contagem era implícita.

## Auditoria da baseline

Levantada no baseline desta spec, não presumida:

- as seis telas têm `<main>`, um `<h1>`, `role="status"` de carregamento,
  `role="alert"` de erro e um controle de retry;
- `app/layout.tsx` declara `lang="pt-BR"`;
- **`/sales` já tem empty state**, com texto "Falta um passo antes de vender"
  e CTA para cadastrar cliente ou produto quando `customers` ou `products` está
  vazio. A primeira versão desta spec afirmou o contrário: a auditoria procurou
  as palavras "nenhum", "vazio" e "empty" e não encontrou esta redação. Um
  levantamento por palavra-chave produz falso negativo, e o achado errado quase
  virou requisito;
- nenhuma tela declara contêiner com `overflow-x`, então não há garantia
  explícita contra rolagem horizontal do corpo em viewport estreito;
- `/inventory`, `/repurchases` e o histórico não usam `htmlFor`, o que é
  esperado por não terem formulário, mas precisa ser afirmado e não suposto;
- o formulário de venda **não alcança carrinho vazio**: `lines` inicia com
  `[newLine()]` e `removeLine` é no-op quando resta uma linha. Não existe estado
  de carrinho vazio para especificar.

## Contrato uniforme de estado

Cada tela que carrega dados tem exatamente quatro estados observáveis, e eles
são mutuamente exclusivos:

```text
carregando -> status observável, nunca um vazio falso
erro       -> mensagem + retry, nunca apresentado como vazio
vazio      -> mensagem própria, nunca apresentada como erro
conteúdo   -> a lista
```

Regras vinculantes:

- carregando usa `role="status"`; erro usa `role="alert"`;
- o retry refaz a leitura sem recarregar a página;
- um conjunto vazio **nunca** é renderizado como erro, e uma falha **nunca**
  como vazio. Esta é a confusão que a TASK-13 já corrigiu uma vez e que esta
  task passa a impedir em toda tela;
- em `/sales` o estado vazio é a **ausência de pré-requisito** — sem clientes ou
  sem produtos — e já existe. Carrinho vazio não é estado alcançável e não é
  requisito.

## Piso de acessibilidade

Por tela:

- exatamente um `<main>` e exatamente um `<h1>`;
- `nav` com `aria-label`;
- todo controle interativo com nome acessível: `htmlFor` para campos de
  formulário, texto visível ou `aria-label` para botões e links;
- foco visível em todo alvo interativo (`focus:ring` já é o padrão do projeto);
- alvo de toque de no mínimo 44px (`min-h-11`) em botões, links de navegação e
  controles de formulário;
- `lang="pt-BR"` no documento.

## Responsividade

- o **corpo da página não rola horizontalmente** em viewport de 320px;
- conteúdo largo — se existir — rola dentro do próprio contêiner com
  `overflow-x`, nunca empurrando a página;
- as seis telas são verificadas em 320px, 768px e 1280px.

## Como o piso deixa de depender de inspeção

O centro desta task é `scripts/ui-hardening-check.mjs`: uma guarda determinística
de código-fonte, no padrão de `scripts/task-12-source-check.mjs`, que lê as seis
telas e falha se qualquer uma perder um item do piso.

A guarda verifica **todo item do piso que seja verificável estaticamente**, por
tela:

| Item do piso | Verificação |
| --- | --- |
| landmark e título | exatamente um `<main>`, exatamente um `<h1>` |
| carregando | `role="status"` |
| erro | `role="alert"` |
| retry | um controle de retry no bloco de erro |
| empty state | um ramo de vazio distinto do ramo de erro |
| navegação | toda `nav` com `aria-label` |
| nome acessível | todo `<button>` e `<Link>` com texto visível ou `aria-label`; todo `<input>` e `<select>` com `htmlFor` correspondente |
| foco visível | `focus:ring` em todo alvo interativo |
| alvo de toque | `min-h-11` em botões, links de navegação e controles |
| data | ausência de `toLocaleDateString` cru |
| overflow | nenhum contêiner com largura fixa em `px` que force rolagem |

`lang="pt-BR"` é verificado uma vez em `app/layout.tsx`.

Fica explícito o que a guarda **não** prova: que um marcador presente é de fato
renderizado, e que o corpo não rola horizontalmente em 320px. Ambos são
comportamento em execução e ficam com o Playwright efêmero.

### Completude da lista

A lista das seis telas vive na guarda, e uma tela nova que não entre nela não é
coberta. A guarda enumera as **rotas** — todo `page.tsx` sob `app/` fora de
`app/api/` — e falha se alguma rota não estiver mapeada para uma tela na lista.

Enumerar por `Workspace.tsx` não bastaria: uma tela futura escrita direto no
`page.tsx`, ou delegando a um componente com outro nome, não criaria arquivo
`Workspace.tsx` algum e a verificação continuaria passando com a rota fora do
piso. Rota é a unidade que o Next.js realmente define.

## Fronteiras

É **proibido**:

- adicionar funcionalidade, campo, rota ou endpoint;
- alterar regra de domínio, schema, migration ou qualquer trigger;
- recalcular previsão ou reimplementar a regra de dia do negócio;
- refatorar ARCH-03 ou reabrir ARCH-01/ARCH-02;
- alterar o comportamento visível além dos estados e do piso descritos aqui.

## Casos de borda

1. Carregamento lento → `role="status"` visível, sem lista vazia enquanto carrega.
2. Falha de rede → erro com retry; o retry bem-sucedido substitui o erro pelo conteúdo.
3. Falha seguida de conjunto vazio → empty state, não o erro anterior.
4. `/sales` sem clientes ou sem produtos → empty state de pré-requisito, com CTA.
5. Produto sem alerta, histórico sem vendas, nenhuma recompra na janela → cada um é vazio, não erro.
5.1. Cliente **com** telefone ausente é **conteúdo**, não vazio: a linha é renderizada normalmente com o placeholder de telefone ausente, conforme o contrato herdado da TASK-12 (AC21). Tratar telefone nulo como vazio contradiz esse contrato e a interface atual.
6. Viewport de 320px em todas as seis telas → sem rolagem horizontal do corpo.
7. Navegação por teclado → foco visível em cada parada, nenhuma armadilha de foco.

## Estratégia de testes

**Guarda determinística** (`scripts/ui-hardening-check.mjs`), sem navegador:
o piso por tela, mais a asserção de que nenhuma tela ficou fora da lista.
Roda em `npm test` e em `validate.yml`.

**Playwright efêmero**, conforme `docs/operations/PLAYWRIGHT-EPHEMERAL.md`:
os quatro estados por tela onde forem alcançáveis, navegação por teclado com
foco visível, e ausência de rolagem horizontal em 320px, 768px e 1280px.
`retries 0`; qualquer retry necessário é FLAKY e bloqueia. Artefatos removidos
após PASS; em `docs/evidence/` fica apenas o resumo.

## Critérios de aceite

AC1. Cada uma das seis telas tem exatamente um `<main>` e exatamente um `<h1>`.

AC2. Cada tela que carrega dados expõe carregando com `role="status"`.

AC3. Cada tela que carrega dados expõe erro com `role="alert"` e um retry que refaz a leitura sem recarregar a página.

AC4. Um conjunto vazio produz empty state próprio e nunca um erro.

AC5. Uma falha produz erro e nunca um empty state.

AC6. `/sales` mantém o empty state de pré-requisito quando não há clientes ou não há produtos, com CTA para o cadastro que falta.

AC6.1. Um cliente sem telefone aparece como conteúdo com placeholder, nunca como estado vazio.

AC7. Toda `nav` tem `aria-label`.

AC8. Todo controle interativo tem nome acessível: `htmlFor`, texto visível ou `aria-label`.

AC9. Botões, links de navegação e controles de formulário têm alvo de toque de pelo menos 44px.

AC10. O documento declara `lang="pt-BR"`.

AC11. O corpo não rola horizontalmente em 320px, em nenhuma das seis telas.

AC12. Conteúdo largo, quando existir, rola no próprio contêiner e não empurra a página.

AC13. `scripts/ui-hardening-check.mjs` falha se qualquer tela perder qualquer item do piso verificável estaticamente, incluindo ramo de vazio, nome acessível, foco visível e alvo de toque.

AC14. A guarda enumera as rotas — todo `page.tsx` sob `app/` fora de `app/api/` — e falha se alguma rota não estiver mapeada para uma tela da lista, mesmo que a tela não use um componente `Workspace.tsx`.

AC15. A guarda roda em `npm test` e é um passo de `validate.yml`.

AC16. Nenhuma funcionalidade, rota, endpoint, regra de domínio, schema ou migration é alterada.

## Validação determinística

`db:validate`, `db:generate`, `db:migrate`, `db:health`, `npm test` incluindo a
nova guarda, `test:repurchase-api`, `test:repurchase-dashboard`,
`test:product-api`, `test:customer-api`, `test:loop-controller`,
`test:loop-v1.4`, `lint`, `typecheck`, `build`, `git diff --check` e varredura
de segredos — todos verdes no HEAD exato do PR.

## Definition of Done

- AC1 a AC16 provados por teste, não por inspeção;
- todos os gates determinísticos verdes no HEAD exato do PR;
- revisão independente publicada para esse HEAD exato, sem findings em aberto;
- revisão publicada antes do merge;
- validação pós-merge verde no merge head antes de fechar a task;
- evidência em `docs/evidence/TASK-14-validation.md`;
- STATE, HANDOFF, ROADMAP e LOOP-REGISTER reconciliados.

## Não escopo

Tema escuro, animações, i18n, offline, PWA, otimização de performance,
auditoria automatizada por ferramenta externa (axe, Lighthouse) e qualquer
alteração de domínio.

## Riscos conhecidos

- **Guarda por código-fonte**: prova estrutura, não aparência. Um `role="alert"`
  presente mas nunca renderizado passaria, e rolagem horizontal em 320px não é
  detectável estaticamente. Ambos ficam com o Playwright efêmero, que observa os
  estados de verdade. A spec lista acima exatamente o que fica de fora.
- **Auditoria por palavra-chave**: a primeira versão desta spec concluiu que
  `/sales` não tinha empty state porque procurou palavras específicas. A
  auditoria da baseline agora cita o texto real de cada estado encontrado.
- **Piso, não teto**: a guarda impede regressão abaixo do piso; não afirma que a
  interface é boa. É deliberado — o objetivo é que a qualidade pare de depender
  de quem revisa.

## Assumptions explícitas

- **A1**: 44px é o alvo mínimo de toque, já materializado como `min-h-11`.
- **A2**: 320px é o viewport estreito de referência.
- **A3**: as seis telas listadas são o escopo completo no baseline desta spec.
