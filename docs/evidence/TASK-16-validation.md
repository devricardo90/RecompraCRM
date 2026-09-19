# TASK-16 — evidência de validação

Escopo: `done_when` da entrada do roadmap — *homologação disponível, smoke
remoto aprovado e sem credenciais expostas*.

Spec: `docs/specs/TASK-16.md` (PR #46, 3 rodadas de revisão, merge `40c35c5`).

## Estado da task: BLOCKED_AWAITING_STAGING

**A TASK-16 não está concluída.** Duas das três cláusulas do `done_when`
dependem de um ambiente que não existe neste repositório, e nenhuma delas foi
executada.

| Cláusula | Estado | Base |
| --- | --- | --- |
| sem credenciais expostas | **PROVADO** | `scripts/secrets-hygiene-check.mjs`, verde em CI, em `npm test` e em `validate.yml` |
| homologação disponível | **NÃO EXECUTADO** | não existe projeto Vercel, banco de homologação nem credencial de deploy |
| smoke remoto aprovado | **NÃO EXECUTADO** | `scripts/remote-smoke-check.mjs` existe e é exercitado contra instância local; nunca rodou contra homologação |

O provedor não é uma decisão em aberto: `docs/product/PROJECT-SDD.md` linha 26
manda `deploy em homologação na Vercel`. O que falta é **provisionamento** —
criar o projeto, o banco e as credenciais — que envolve conta, custo e acesso,
e é ação do owner.

Este documento não afirma aprovação que não houve.

## O que foi provado por teste

`npm run test:task-16-guards` → `scripts/task-16-guards-check.mjs`.

### Guard de credenciais

`scripts/secrets-hygiene-check.mjs`, executado contra a árvore versionada
real:

| Regra | O que reprova |
| --- | --- |
| 1 | arquivo `.env`/`.env.<algo>` versionado que não seja `.env.example` |
| 2 | URL de conexão com senha embutida fora da allowlist |
| 3 | credencial que não é URL: chave PEM, ou chave de nome sensível com valor literal |
| 4–5 | allowlist explícita por caminho e valor, **com falha quando uma entrada deixa de casar** |
| 6 | segredo literal em workflow onde se espera `secrets.*` |
| 7 | valor não-placeholder em `.env.example`, só para chaves de nome sensível |

A regra 5 é o ponto do desenho: allowlist que só cresce lê como garantia sem
ser. Hoje são **4 entradas**, cada uma com motivo declarado, e todas casando.

### Verificação de revisão

`app/api/version/route.ts` serve `VERCEL_GIT_COMMIT_SHA ?? APP_REVISION ?? null`.

Provado contra instância local real, em schema próprio descartado no fim:

- a rota serve `APP_REVISION` quando `VERCEL_GIT_COMMIT_SHA` está ausente —
  exercita o ramo de fallback da precedência;
- o smoke **passa** contra essa instância sadia com o revision esperado;
- o smoke **reprova** contra a mesma instância sadia quando o revision
  esperado difere, e a mensagem nomeia `/api/version`.

Esse último caso é o que a verificação existe para pegar: um deploy que falhou
e deixou a revisão anterior no ar responde corretamente em todas as outras
rotas.

### Caminhos de falha do smoke

| Caso | Resultado |
| --- | --- |
| URL inalcançável | falha nomeando a causa, sem status — não existe resposta HTTP |
| `SMOKE_BASE_URL` ausente | falha nomeando a variável |
| revision divergente | falha nomeando a rota |
| vazamento em resposta | `classifyLeak` detecta string de conexão, `DATABASE_URL` e stack trace |

### Cobertura das regras do guard

Cada regra tem fixture que ela **precisa reprovar** e, onde faz sentido, uma
que precisa aceitar:

| Regra | Reprova | Aceita |
| --- | --- | --- |
| 1 | `.env`, `.env.production` versionados | `.env.example` |
| 2 | URL de conexão com senha fora da allowlist | — |
| 3 | bloco PEM; `"VERCEL_TOKEN": "..."` em JSON | placeholder; referência `secrets.*` |
| 5 | entrada de allowlist que não casa mais nada | — |
| 6 | segredo literal em workflow | — |
| 7 | senha real em `.env.example` | `POSTGRES_USER`, `POSTGRES_PORT` |

Isso só é testável porque `scan` é função pura sobre lista de arquivos e
leitor injetados. A versão anterior lia `git ls-files` inline e só rodava
contra a árvore real — cinco das sete regras não tinham **nenhuma** asserção
de falha, e uma regressão em qualquer uma delas passaria verde. Achado por
revisão independente na PR #47, e é exatamente o problema que este guard
existe para evitar, virado contra ele mesmo.

As fixtures vivem em `scripts/fixtures/secrets-hygiene-fixtures.mjs`, o
**único** caminho excluído do scan. A suíte afirma que a lista de exclusão tem
exatamente uma entrada: exclusão que alarga silenciosamente seria pior que o
crescimento de allowlist que ela substituiu.

### Regressões fechadas por revisão independente

Duas falhas **silenciosas** do guard, encontradas na PR #47 e agora asseguradas
diretamente:

1. `"VERCEL_TOKEN": "..."` não casava **nada** — o padrão consumia a aspa de
   abertura como delimitador e exigia os dois-pontos logo após a chave. Um
   token de deploy em `vercel.json`, o lugar mais provável para um vazar, e
   exatamente o caso para o qual a regra 3 foi escrita.
2. A allowlist casava por containment nos dois sentidos, o que isentava
   qualquer valor que fosse substring de um placeholder aprovado.

Ambas passavam no guard enquanto deixavam o caso passar, então há asserção
direta sobre cada uma: uma regressão falha em vez de restaurar garantia falsa.

## Validação determinística

| Gate | Resultado |
| --- | --- |
| `npm run lint` | PASS |
| `npm run test:secrets-hygiene` | PASS |
| `npm run test:task-16-guards` | PASS |
| `validate.yml` → *Test secrets hygiene* | PASS |
| `validate.yml` → *Test TASK-16 guards* | PASS |

## Disposição por AC

| AC | Estado |
| --- | --- |
| AC1–AC8 | **PROVADO** — cada uma das sete regras exercitada contra fixture que ela precisa reprovar, mais os casos que precisa aceitar |
| AC9 | **PROVADO** — smoke exige `SMOKE_BASE_URL` e falha nomeando-a |
| AC10 | **PROVADO** — cinco rotas, forma da resposta e não só status |
| AC11 | **PROVADO** — `classifyLeak` sobre três formas de vazamento, e classificação roda em **qualquer** resposta, não só 200: uma página de erro 500 que vaze stack trace é reportada como vazamento e não apenas como status ruim |
| AC12 | **PROVADO** — o smoke não emite `POST`/`PUT`/`DELETE` |
| AC13 | **PROVADO** — falhas nomeiam status, erro de rede ou variável, conforme o caso |
| AC14–AC15 | **PROVADO** — em `npm test` e em `validate.yml` |
| AC16 | **PROVADO** — este documento |
| AC17 | **PROVADO** — a dependência de ambiente está nomeada aqui e na spec como pendência do owner |
| AC18 | **PROVADO** — regra 3 com fixture PEM e fixture de token JSON citado, mais a asserção de regressão sobre o padrão |
| AC19–AC20 | **PROVADO** — contra instância local sadia, incluindo o ramo de fallback e a rejeição de revisão divergente |

**Nenhum AC cobre o deploy em si**, porque a spec deliberadamente não o
colocou nos critérios: ele depende do ambiente que falta.

## O que falta para fechar a TASK-16

Ações do owner:

1. criar o projeto Vercel para este repositório;
2. provisionar um Postgres de homologação, separado do de desenvolvimento;
3. definir `DATABASE_URL` no projeto e garantir `prisma migrate deploy` no
   build ou em passo de deploy;
4. confirmar que `VERCEL_GIT_COMMIT_SHA` chega ao runtime, ou definir
   `APP_REVISION` manualmente.

Depois disso, o loop consegue executar o deploy e rodar:

```
SMOKE_BASE_URL=<url> SMOKE_EXPECTED_REVISION=<sha> npm run smoke:remote
```

e só então a task pode ser marcada COMPLETED, com a evidência do smoke
aprovado registrada aqui.

## Não coberto, deliberadamente

- O deploy e o smoke contra homologação — ver acima.
- Domínio próprio, CDN, observabilidade, rollback.
- Correção da limpeza engolida das verificações de integração existentes
  (achado da TASK-15, fora de escopo).
