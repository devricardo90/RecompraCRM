# TASK-16 Spec — Deploy de homologação

## Gate de fonte da verdade

Esta spec é a fonte da verdade da TASK-16. O `done_when` da entrada do
roadmap é literal:

> homologação disponível, smoke remoto aprovado e sem credenciais expostas.

Nada aqui reabre TASK-01..TASK-15.

## A dependência que esta spec não pode resolver sozinha

**"Homologação disponível" exige um ambiente remoto que não existe neste
repositório.** Não há alvo de hospedagem, banco de homologação, nem
credencial de deploy em lugar nenhum da árvore — verificado: nenhum
`vercel.json`/`vercel.ts`, nenhum `Dockerfile`, nenhum workflow de deploy, e
o único segredo referenciado em `.github/workflows/` é
`CLAUDE_CODE_OAUTH_TOKEN`.

Provisionar isso é decisão do owner: envolve escolher provedor, criar conta,
assumir custo e emitir credenciais. Não é uma decisão que o loop tome
sozinho, e o deploy em si é uma ação para fora.

Então a task é deliberadamente dividida:

| Parte | Quem faz | Bloqueado? |
| --- | --- | --- |
| Spec, guard de credenciais, script de smoke remoto | o loop | não |
| Contrato que qualquer alvo precisa satisfazer | o loop | não |
| Provisionar ambiente e credenciais | owner | **sim** |
| Executar o deploy e o smoke contra ele | o loop, depois | sim |

A spec é escrita **agnóstica de provedor**: define o contrato, não o
fornecedor. Quando o ambiente existir, o deploy é um passo, não um projeto.

## Contrato do alvo de homologação

Qualquer alvo serve se satisfizer:

1. runtime Node compatível com o `next build` deste repositório;
2. `DATABASE_URL` injetada como variável de ambiente do processo, nunca
   versionada;
3. migrações aplicadas no deploy (`prisma migrate deploy`) contra o banco de
   homologação, não contra `public` de desenvolvimento;
4. URL HTTPS alcançável publicamente ou pelo executor do smoke;
5. logs acessíveis o suficiente para diagnosticar um smoke reprovado.

O que o alvo **não** precisa: CDN, domínio próprio, réplica, autoscaling.
Homologação aqui é "uma instância alcançável rodando este commit contra um
banco próprio".

## Auditoria da baseline: o que já está certo

Verificado na árvore atual, não presumido:

| Item | Estado |
| --- | --- |
| `.env` versionado | não — `.gitignore` tem `.env`, `.env.*`, com `!.env.example` |
| `.env.example` | versionado, e deve estar: só placeholders |
| Segredos em workflows | só `secrets.CLAUDE_CODE_OAUTH_TOKEN`, via `secrets.*` |
| Variáveis lidas em código | `DATABASE_URL`, `NODE_ENV`, `RICK_LOOP_WATCH_MAX_CYCLES` |
| Strings tipo `password=...` em arquivo versionado | nenhuma |

**Dois arquivos versionados contêm URL de Postgres com credencial**, e ambos
são deliberados:

- `.env.example` → `recompra_local_dev_only`
- `.github/workflows/validate.yml` → `recompra_ci_only`

São placeholders de serviços efêmeros, e o próprio nome diz isso. Um guard
ingênuo de "nenhuma credencial em arquivo versionado" reprovaria os dois no
primeiro dia, seria silenciado, e deixaria de valer para sempre.

## O guard de credenciais

`scripts/secrets-hygiene-check.mjs`. O valor dele é pegar credencial **nova**,
não relitigar as duas conhecidas.

Regras:

1. Nenhum arquivo versionado casa `.env` ou `.env.<algo>`, exceto
   `.env.example`.
2. Nenhum arquivo versionado contém URL de conexão com senha embutida, exceto
   as entradas de uma allowlist explícita.
3. A allowlist é um literal por entrada — caminho e o valor exato tolerado —
   com uma linha dizendo por que é seguro. Nada de regex amplo: uma allowlist
   por padrão vira uma exceção que engole o caso que importava.
4. Uma entrada da allowlist que não casa mais nada é **falha**, não sucesso
   silencioso. Allowlist obsoleta é dívida que ninguém vê.
5. Workflows referenciam segredo só via `secrets.*`; um valor literal onde se
   espera `secrets.*` é falha.
6. `.env.example` não pode conter valor que não seja placeholder óbvio: cada
   valor precisa casar um padrão declarado (`*_local_dev_only`, `*_ci_only`,
   vazio, ou `changeme*`).

Roda em `npm test` e em `validate.yml`, como os outros guards.

## O smoke remoto

`scripts/remote-smoke-check.mjs`, recebendo a URL base por
`SMOKE_BASE_URL`.

**Somente leitura por padrão.** Um smoke que escreve polui homologação a cada
execução, e o trigger de `Sale_deletion_blocked` torna a limpeza impossível
lá também — a mesma armadilha que a TASK-15 encontrou. Escrever exigiria em
homologação o mesmo isolamento por schema, o que o alvo remoto não expõe.

Verifica:

1. `GET /` responde 200 e HTML;
2. `GET /api/products` responde 200 com `{ products: [...] }`;
3. `GET /api/customers` responde 200 com `{ customers: [...] }`;
4. `GET /api/repurchases` responde 200 com `generatedAt`, `counts` e `items`
   — o que prova que a aplicação alcançou o banco, porque essa rota consulta
   `saleItem` e aplica `businessDayEndUtc`;
5. nenhuma resposta traz `DATABASE_URL`, string de conexão, ou stack trace;
6. cada falha nomeia a rota e o status recebido.

O item 4 é a prova real de conectividade: uma instância no ar com banco
inacessível devolve 503 nessa rota, e o smoke reprova.

Falha com mensagem acionável e `exitCode` não zero, para que um passo de CI
de deploy possa depender dele.

## Estratégia de testes

O guard de credenciais é determinístico e roda em qualquer lugar: testado
contra a árvore real e contra fixtures que ele **precisa** reprovar.

O smoke remoto é testado localmente contra uma instância deste repositório
(mesmo mecanismo de schema isolado da TASK-15), provando que passa contra uma
instância sadia e reprova contra uma URL morta. Isso não substitui rodá-lo
contra homologação — substitui apenas a dúvida sobre se o script funciona.

## Critérios de aceite

AC1. `scripts/secrets-hygiene-check.mjs` existe, roda sem argumentos e falha
com `exitCode` não zero em qualquer violação.

AC2. O guard reprova um arquivo versionado casando `.env`/`.env.<algo>` que
não seja `.env.example`.

AC3. O guard reprova URL de conexão com senha embutida em arquivo versionado
fora da allowlist.

AC4. A allowlist é explícita por caminho e valor, com justificativa por
entrada, e cobre exatamente `.env.example` e `.github/workflows/validate.yml`.

AC5. Uma entrada de allowlist que não casa mais nada faz o guard falhar.

AC6. O guard reprova valor literal onde um workflow deveria usar `secrets.*`.

AC7. O guard reprova valor em `.env.example` que não case um padrão de
placeholder declarado.

AC8. Cada falha do guard nomeia arquivo e motivo.

AC9. `scripts/remote-smoke-check.mjs` existe e exige `SMOKE_BASE_URL`,
falhando explicitamente quando ausente.

AC10. O smoke verifica as quatro rotas acima, incluindo a forma da resposta,
não só o status.

AC11. O smoke reprova se qualquer resposta contiver string de conexão ou
stack trace.

AC12. O smoke é somente leitura: não emite `POST`, `PUT` nem `DELETE`.

AC13. Cada falha do smoke nomeia rota e status.

AC14. `npm run test:secrets-hygiene` existe e entra no agregado `npm test`.

AC15. `.github/workflows/validate.yml` executa o guard de credenciais.

AC16. `docs/evidence/TASK-16-validation.md` registra o que foi provado, e
registra explicitamente que o deploy e o smoke contra homologação **não**
foram executados enquanto o ambiente não existir — sem afirmar aprovação que
não houve.

AC17. A spec e a evidência nomeiam a dependência de ambiente como pendência
do owner, não como item concluído.

## Validação determinística

`npm run lint`, `npm run typecheck`, `npm run build`, `npm test` (incluindo
`test:secrets-hygiene`, novo) verdes no HEAD exato do PR.

## Definition of Done

- AC1 a AC17 provados por teste, não por inspeção;
- todos os gates determinísticos verdes no HEAD exato do PR;
- preflight determinístico passando antes de qualquer revisão despachada;
- revisão independente publicada para esse HEAD exato, sem findings em
  aberto;
- validação pós-merge verde no merge head;
- evidência em `docs/evidence/TASK-16-validation.md`;
- STATE, HANDOFF, ROADMAP e LOOP-REGISTER reconciliados — incluindo as
  narrativas e as seções históricas, não só os campos rastreados.

**A task não é marcada COMPLETED enquanto o deploy e o smoke remoto não
tiverem acontecido de verdade.** O que esta PR entrega é tudo o que pode ser
entregue sem ambiente; o `done_when` continua parcialmente aberto, e dizer o
contrário seria afirmar aprovação inexistente.

## Não escopo

- Escolher provedor de hospedagem — decisão do owner.
- Criar conta, banco de homologação ou credencial.
- Domínio próprio, CDN, observabilidade, rollback automatizado.
- Corrigir a limpeza engolida das verificações de integração (achado da
  TASK-15).

## Riscos conhecidos

**Um guard de credenciais com allowlist vira teatro se a allowlist crescer.**
Por isso AC5: entrada obsoleta falha. Uma allowlist que só cresce é pior que
nenhum guard, porque dá garantia falsa.

**O smoke somente-leitura não prova que escrita funciona em homologação.**
É uma limitação declarada, não um descuido: provar escrita exigiria isolamento
que o alvo remoto não oferece. A evidência diz isso explicitamente.

**`done_when` fica parcialmente aberto ao fim desta PR.** É o estado honesto.
A alternativa — marcar COMPLETED com o deploy por fazer — quebraria o
critério de fechamento da TASK-17, que conta tasks verificadas.

## Assumptions explícitas

- **A1**: o alvo de homologação, quando existir, aceita `DATABASE_URL` por
  variável de ambiente e roda `prisma migrate deploy` no deploy. Se não
  aceitar, o contrato acima muda e esta spec é corrigida antes da
  implementação.
- **A2**: a forma das rotas e das funções de domínio é lida do código, não
  da memória — cinco divergências desse tipo foram corrigidas na spec da
  TASK-15 antes de existir implementação.
- **A3**: o banco de homologação é separado do de desenvolvimento. Rodar
  homologação contra o banco local reintroduziria exatamente o risco que a
  TASK-15 eliminou por isolamento de schema.
