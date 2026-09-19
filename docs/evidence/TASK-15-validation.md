# TASK-15 — evidência de validação

Escopo: `done_when` literal da entrada do roadmap — *cliente → produto →
venda → estoque → previsão → dashboard passa ponta a ponta*.

Spec: `docs/specs/TASK-15.md` (PR #43, 5 rodadas de revisão, merge `097b023`,
pós-merge Validate 35377720405 SUCCESS).

## O que a task provou, e o que já estava provado

Doze verificações existentes provam uma fatia cada e param ali. Nenhuma delas
cria um cliente, vende um produto a ele e confirma que **aquele** cliente
chega à previsão e ao dashboard. A costura entre as fatias era o que faltava,
e é o que `scripts/task-15-e2e-check.mjs` passa a provar.

## Teste determinístico

`npm run test:e2e-chain` → `scripts/task-15-e2e-check.mjs`.

Uma execução, um cliente, um produto, duas vendas, tudo pelas rotas HTTP
reais:

| Estágio | Rota | Asserção |
| --- | --- | --- |
| cliente | `POST /api/customers` | 201 e registro devolvido |
| produto | `POST /api/products` | 201, `consumptionDays` round-trip |
| venda | `POST /api/sales` (×2) | 201, `items: [{ productId, quantity }]` |
| estoque | `GET /api/products` | `currentStock === 100 − 2 − 1 === 97`, valor exato |
| previsão | `SaleItem.expectedRepurchaseAt` | `soldAt + quantity × consumptionDays`, ao segundo |
| dashboard | `GET /api/repurchases` | 2 linhas do cliente criado, em faixas diferentes |
| volta | `GET /api/customers/[id]/sales` | as duas vendas no histórico |

Cada falha nomeia o estágio (`[estoque] stock is ...`), não só o valor.

O estoque é conferido contra o valor exato, não contra "menor que o inicial":
uma asserção de desigualdade passaria mesmo se o decremento fosse do tamanho
errado.

A previsão é lida de `SaleItem`, não de `Sale` — o campo é coluna do item.
Uma das vendas usa `quantity = 2` para que a multiplicação da fórmula seja
exercida em vez do caso degenerado `quantity = 1`.

As duas vendas diferem **apenas em `soldAt`** (`−40 dias` e `−7 dias`), com
margem em dias suficiente para que a classificação por número de dia útil não
mude conforme a hora da execução.

## Segurança dos dados: estrutural, não por disciplina

O teste roda em schema próprio (`task15_<timestamp>_<pid>`), criado por ele,
migrado com `prisma migrate deploy`, e descartado com `DROP SCHEMA ... CASCADE`
no `finally`.

Isso não é preferência de estilo. `Sale_deletion_blocked` levanta exceção em
qualquer `DELETE` sobre `Sale` — deliberadamente, porque restaurar estoque
exige uma política que TASK-08 não definiu. Limpeza por linha é impossível
neste schema. `DROP SCHEMA CASCADE` remove a tabela junto com o trigger, então
não há `DELETE` por linha para bloquear.

Verificado após a execução:

```
leftover task15* schemas: []
public -> customers: 63  products: 85  sales: 78
```

Os mesmos números de antes da execução. O schema `public` não foi lido nem
escrito.

Uma falha no `DROP` faz o teste falhar e marca `process.exitCode = 1`. Ela
**não** é engolida — ver o achado abaixo.

## Achado: a limpeza das verificações existentes nunca funcionou

Ao diagnosticar por que a limpeza por linha era impossível, apareceu um
defeito nas verificações de integração já existentes:

```js
await prisma.sale.delete({ where: { id } }).catch(() => {});
```

O `catch` vazio engole a exceção do trigger; os `delete` de produto e cliente
falham em seguida por chave estrangeira e também são engolidos; e a limpeza
reporta sucesso sem ter apagado nada. É a explicação de os dados de
desenvolvimento terem acumulado registros de execuções anteriores.

Registrado como achado. Corrigi-lo não é escopo da TASK-15 — está nomeado aqui
para que a próxima pessoa não reinvente a investigação.

## Playwright — efêmero

6 cenários, `retries: 0`, **PASS**, 19,0s.

| Cenário | Verifica |
| --- | --- |
| dashboard | o cliente da cadeia aparece, 2 linhas, produto visível |
| inventory | `inventory-summary` renderiza |
| products | o estoque exato restante (97) aparece na tela |
| home | o cliente da cadeia está listado |
| histórico | `history-sale` × 2, título com o nome do cliente, item com o produto |
| 320px | sem rolagem horizontal no dashboard |

Diferente da passagem da TASK-14, que precisou de `page.route` para não tocar
nos dados compartilhados, esta semeia uma cadeia real em schema próprio e lê
as telas contra ela. É o "fluxo E2E mais amplo" que
`docs/operations/PLAYWRIGHT-EPHEMERAL.md` pede no fim do roadmap, e é mais
forte que mock: os pixels vêm das mesmas linhas que o teste de API exercita.

Spec temporário, config e `test-results` removidos após o PASS; nada
relacionado a Playwright ficou versionado ou no diretório de trabalho.

### Três correções antes do PASS — e por que não são FLAKY

A política manda tratar retry necessário como FLAKY. Nenhuma das três foi
retry: foram defeitos no meu próprio código de teste, corrigidos na origem.

1. **`/customers` não existe.** O teste navegava para uma rota inventada; as
   rotas de página são `/`, `/products`, `/sales`, `/inventory`,
   `/repurchases` e `/customers/[id]/history`. Mesma classe de erro que a
   revisão da spec pegou cinco vezes — supor a forma em vez de lê-la.
2. **Timeout na primeira navegação.** O Next em modo dev compila a rota no
   primeiro request, e os 30s caíam sobre a primeira navegação do Playwright
   enquanto a mesma rota passava depois. Resolvido aquecendo cada rota antes
   da suíte, não inflando timeout para esconder.
3. **Histórico ainda em estado de carregamento.** A tela busca no cliente e o
   `expect` padrão de 5s expirava antes. Resolvido esperando o estado
   resolvido (`history-list`), não relaxando a asserção.

Nenhum teste foi reexecutado na esperança de passar.

## Validação determinística

| Gate | Resultado |
| --- | --- |
| `npm run lint` | PASS |
| `npm run test:e2e-chain` | PASS |
| `npm test` (agregado, inclui o novo) | ver execução do PR |
| `validate.yml` → *Test TASK-15 end-to-end chain* | ver execução do PR |

## Disposição por AC

| AC | Como foi provado |
| --- | --- |
| AC1 | uma execução percorre os seis estágios, um cliente e um produto |
| AC2 | 201 + registro devolvido em `POST /api/customers` |
| AC3 | `currentStock`/`minimumStock`/`consumptionDays` explícitos, round-trip conferido |
| AC4 | `customerId` + `items: [{ productId, quantity }]` |
| AC5 | `GET /api/products`, seleção por id, valor exato |
| AC6 | `SaleItem.expectedRepurchaseAt` vs `soldAt + quantity × consumptionDays`, com `quantity = 2` numa venda |
| AC7 | o cliente criado aparece em `GET /api/repurchases` |
| AC8 | duas vendas do mesmo cliente/produto em faixas diferentes, por `soldAt` |
| AC9 | as duas vendas em `GET /api/customers/[id]/sales` |
| AC10 | schema próprio por execução; `public` nunca tocado |
| AC11 | `DROP SCHEMA CASCADE` no `finally`, falha não engolida |
| AC12 | nenhuma asserção usa contagem global |
| AC13 | toda falha nomeia o estágio |
| AC14 | `test:e2e-chain` no `package.json` e no agregado `npm test` |
| AC15 | passo próprio em `.github/workflows/validate.yml` |
| AC16 | 6 cenários Playwright efêmeros, `retries: 0`, artefatos removidos |
| AC17 | este documento |
| AC18 | nenhum critério atribui `expectedRepurchaseAt` a `Sale` |

## Não coberto, deliberadamente

- Deploy e ambiente remoto — TASK-16.
- Fechamento do roadmap — TASK-17.
- Correção da limpeza das verificações existentes — achado registrado acima.
- Carga, performance e concorrência além do que
  `sale-registration-concurrency-check` já cobre.
