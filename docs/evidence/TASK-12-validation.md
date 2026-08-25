# TASK-12 — Dashboard de recompra: evidência de validação

Spec: `docs/specs/TASK-12.md`
Baseline: `27b3959c7394b030e9f5639abd368a1c12f55516` (`main`)
Branch: `feat/TASK-12-repurchase-dashboard-impl`
Decisão de dono: OWNER-01 resolvida — Opção A, uma linha por item de venda

## O que foi entregue

Uma leitura transversal das previsões de recompra já persistidas, classificada
em vencidas, hoje e próximos sete dias.

| Arquivo | Papel |
| --- | --- |
| `lib/sales/repurchaseForecast.ts` | regra canônica de classificação, fora da UI |
| `lib/format/businessDate.ts` | `businessDayNumber` e `businessDayEndUtc` acrescentados ao contrato compartilhado |
| `app/api/repurchases/route.ts` | projeção somente leitura, GET apenas |
| `app/repurchases/` | página e workspace |
| `prisma/migrations/20260825140000_index_sale_item_expected_repurchase` | único delta de schema |

## Propriedade da previsão

A previsão continua sendo derivada e mantida pelos triggers da TASK-09
(ARCH-01 Opção A). Esta task lê `SaleItem.expectedRepurchaseAt` e nunca a
recalcula nem a escreve. `scripts/task-12-source-check.mjs` falha se
`consumptionDays` aparecer em qualquer arquivo da task, se houver atribuição a
`expectedRepurchaseAt`, se surgir método de mutação do Prisma ou `$executeRaw`,
se a rota exportar handler diferente de GET, ou se a página reclassificar em vez
de renderizar o balde vindo do servidor.

A prova de que a propriedade é real está no harness de banco: para encenar uma
linha legada com previsão `NULL` foi preciso desligar o trigger, porque a
escrita direta é recomputada pelo próprio banco. A previsão não é forjável pela
aplicação.

## Classificação

Sobre **dias do negócio**, não instantes, e sempre a partir de **um único
instante de referência** capturado no início da requisição e emitido como
`generatedAt`. `items` e `counts` saem da mesma passagem, então um resumo que
discorde da lista não é representável.

A janela é aberta para trás e fechada em `hoje + 7`. Um limite inferior
esvaziaria exatamente o balde de vencidas.

## Gates determinísticos

| Gate | Resultado |
| --- | --- |
| `db:validate` / `db:generate` | PASS |
| `db:migrate` (23 migrations) | PASS |
| `db:health` | PASS |
| `npm test` (14 suítes) | PASS |
| `test:repurchase-projection` | PASS |
| `test:repurchase-dashboard` (PostgreSQL) | PASS |
| `test:repurchase-api` (rota real via HTTP) | PASS |
| `test:task-12-source` | PASS |
| `test:task-13-source` / `test:task-13-schema` | PASS |
| `lint` / `typecheck` / `build` | PASS |

## Cobertura por critério

AC1–AC4, AC6–AC8, AC15, AC18, AC19 e AC22 em
`scripts/repurchase-forecast-check.mjs`; AC1, AC2, AC4, AC5, AC7, AC9, AC10,
AC17 e AC21 contra PostgreSQL em `scripts/repurchase-dashboard-check.mjs`;
AC1, AC2, AC4, AC7, AC8, AC16 e AC21 contra a rota real em
`scripts/repurchase-api-integration-check.mjs`; AC11, AC12, AC20 e AC15 em
`scripts/task-12-source-check.mjs`; AC13 pelos
quatro links de navegação; AC14 pelos estados de carregamento, erro e vazio da
página.

AC9 e AC10 são a prova de frescor: alterar `consumptionDays` e `soldAt`
reclassifica o item na leitura seguinte, e o valor relido do banco é o que
mudou — esta task não recalculou nada.

## Ajuste em guarda existente

`scripts/task-13-schema-scope-check.mjs` comparava a baseline da TASK-13 contra
`HEAD` e a árvore de trabalho, o que afirmava que **nenhuma** mudança de schema
poderia ocorrer no repositório depois daquele ponto. Isso bloqueava o índice
aditivo aprovado da TASK-12 em vez de guardar a TASK-13. A verificação passou a
ser fixada no intervalo já mergeado da TASK-13
(`2995589c..e36710799`), preservando exatamente a propriedade que ela existe
para provar.

## Cobertura de CI

Toda suíte declarada em `package.json` roda em `validate.yml`. Uma auditoria de
cada script `test:*` contra o workflow encontrou cinco não referenciados —
incluindo `test:task-13-source` e `test:task-13-schema`, sem execução em CI
desde a TASK-13. Uma guarda que não roda é uma afirmação, não um controle.

O checkout passou a usar `fetch-depth: 0`: a guarda de escopo de schema compara
um intervalo histórico de commits, que um clone raso não contém.

## Limitação herdada

L4: previsão por duração fixa pode cair no dia da própria venda em venda
retroagida cruzando virada de horário de verão. Residual aceito, herdado da
TASK-09; o dashboard exibe o que está persistido e não corrige.
