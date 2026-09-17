# ARCH-04 Spec — Review Trigger Economics (OWNER-02)

Status: SPEC_IN_REVIEW
Source: owner authorization OWNER-02, recorded `docs/operations/STATE.md` /
`docs/operations/HANDOFF.md` (2026-09-17); `docs/roadmap/ROADMAP.md` ARCH-04
Depends on: none (TASK-14 closed; no product code touched)
Baseline: `6eae01631284742a7c06f47e411f6fa77361ea81` (`main`)
Branch: `docs/ARCH-04-spec` (spec), implementação em branch própria

## Gate de fonte da verdade

O owner autorizou, em duas mensagens (a primeira genérica, a segunda com a
arquitetura exata), substituir o disparo automático de revisão Claude a cada
push por um disparo determinístico feito pelo controller/watcher. A segunda
mensagem fixa a sequência obrigatória, proíbe explicitamente enfraquecer o
gate de merge, e lista dez requisitos de implementação numerados — este
documento os trata como piso, não como sugestão.

Nenhuma parte desta task altera `evaluateMergeAllowed`, `isCleanReviewResult`,
`countUnresolvedFindings` ou qualquer outra função do gate de merge em
`scripts/rick-loop-controller.mjs`. O gate de merge já lê evidência do GitHub
(reviews, comentários, threads) sem nunca perguntar como a Action foi
disparada — `prReview()` (`rick-loop-controller.mjs:704-735`) resolve a
revisão âncora inteiramente a partir de `gh api pulls/:n/reviews`,
`issues/:n/comments` e `reviewThreads`, nenhum dos quais registra o gatilho da
execução. Trocar o gatilho é seguro para o gate de merge por construção; o
risco real está em garantir que o gatilho novo dispara quando deveria e nunca
dispara a mais.

## Objetivo

Parar de gastar uma revisão Claude completa a cada push para uma PR — hoje
`.github/workflows/claude-pr-review.yml:3-5` dispara em
`pull_request: [opened, synchronize, ready_for_review, reopened]`, então uma
sequência típica de correções (como as quatro rodadas da PR #35) paga uma
revisão por push mesmo quando pushes intermediários ainda não passaram no CI.
O controller/watcher passa a disparar exatamente uma revisão por HEAD, e
somente depois que CI, validação autoritativa e preflight determinístico já
passaram nesse HEAD exato.

## Escopo

Dentro do escopo:

- `.github/workflows/claude-pr-review.yml`: ganha um segundo gatilho,
  `workflow_dispatch` com `pr_number` e `expected_head_sha` como inputs
  obrigatórios; o job passa a resolver PR/HEAD do evento que efetivamente
  disparou (`workflow_dispatch` ou `pull_request`) em vez de assumir sempre
  `github.event.pull_request.*`.
- `scripts/rick-loop-preflight.mjs` (novo): checagens mecânicas
  determinísticas que devem passar antes de qualquer disparo de revisão.
- `scripts/rick-loop-review-dispatch.mjs` (novo): dado um número de PR,
  resolve o HEAD exato, exige CI verde nesse HEAD, exige preflight PASS,
  verifica idempotência (já existe alguma execução de
  `claude-pr-review.yml` para esse HEAD?) e só então dispara
  `workflow_dispatch`.
- `scripts/rick-loop-watcher.mjs`: quando observa `WAIT_FOR_CODEX` /
  `WAIT_FOR_INDEPENDENT_REVIEW` e nenhuma execução existe ainda para o HEAD
  atual (`claudeReviewRetryAction` retorna `NO_RUN`), chama o dispatcher em
  vez de não fazer nada. O caminho de *retry* de uma execução existente que
  falhou (`RERUN`, `retryClaudeReview`) não muda.
- Bootstrap em duas PRs (ver "Sequência de bootstrap"), para nunca remover o
  gatilho automático antes do caminho novo estar provado.
- Atualização da narrativa do skill `.claude/skills/loop/SKILL.md`
  ("Review result contract") e `loop_version`, para não descrever mais o
  disparo automático por `synchronize` como o mecanismo vigente depois da
  PR 2.

Fora do escopo:

- Qualquer mudança em `evaluateMergeAllowed`, `isCleanReviewResult`,
  `countUnresolvedFindings`, `selectMergeResult`, `buildAnchoredResults` ou
  qualquer outra função do gate de merge.
- Qualquer mudança de comportamento de produto, schema, migration ou rota.
- Reescrever o prompt de revisão do Claude além do necessário para resolver
  PR/HEAD pelo trigger correto.
- `STATE_POINTER_CONSISTENCY`, `BASELINE_POINTER_CONSISTENCY`, integridade do
  LOOP-REGISTER, semântica `current_task`/`next_eligible_task`,
  reconciliação remote-first e métricas de uso de revisão além do que o
  preflight determinístico cobre mecanicamente — rastreados como `ARCH-05`,
  não bloqueante (ver "Não escopo").

## Auditoria da baseline

Levantada no baseline desta spec, não presumida:

- `.github/workflows/claude-pr-review.yml:3-5` dispara em
  `pull_request: [opened, synchronize, ready_for_review, reopened]` — todo
  push para uma PR aberta dispara uma revisão nova, mesmo que o HEAD anterior
  ainda estivesse aguardando CI.
- `.github/workflows/claude-pr-review.yml:76` já fixa `--max-turns 50`; o
  owner pediu para preservar esse valor, não introduzi-lo.
- O gate de merge (`rick-loop-controller.mjs:801-814`) já lê a revisão
  inteiramente do GitHub, âncorada ao HEAD exato (`review.anchored`,
  `evaluateMergeAllowed`), sem nenhuma dependência de como a execução foi
  disparada.
- `rick-loop-watcher.mjs:77-98` (`retryClaudeReview`) já sabe re-executar
  (`gh run rerun`) uma execução existente que falhou ou está velha, com
  cooldown de uma hora
  (`REVIEW_RETRY_COOLDOWN_MS`); mas nunca dispara uma execução que não
  existe — ele assume que o gatilho automático já criou uma.
  `claudeReviewRetryAction` retorna `"NO_RUN"` nesse caso e o chamador
  (`main()`, linha 117) simplesmente ignora esse retorno.
- Não existe hoje nenhum script `rick-loop-preflight.mjs` nem
  `rick-loop-review-dispatch.mjs`; `detectStateDrift`
  (`rick-loop-controller.mjs:324-373`) já existe e cobre boa parte da
  checagem mecânica de consistência de ponteiros — o preflight novo a
  reaproveita em vez de duplicá-la.
- `docs/roadmap/ROADMAP.md` não tem nenhum item `ARCH-03`; `ARCH-04` existe
  e já bloqueia `TASK-15` via `depends_on` (fechado na PR #33/#35). Este
  spec não reabre essa decisão.

## Arquitetura da mudança

### Sequência obrigatória (do owner, reafirmada)

```
PUSH
  -> CI (Validate)
  -> validação autoritativa (testes determinísticos deste próprio ARCH-04)
  -> preflight determinístico (rick-loop-preflight.mjs)
  -> READY_FOR_INDEPENDENT_REVIEW
  -> workflow_dispatch (rick-loop-review-dispatch.mjs)
  -> revisão independente Claude
  -> CLEAN (zero achados não resolvidos, âncorada ao HEAD exato)
  -> MERGE
```

Um push isolado nunca invoca o Claude. `READY_FOR_INDEPENDENT_REVIEW` é o
mesmo instante em que `classifyLoopDecisionInner` hoje retorna
`WAIT_FOR_CODEX` pela primeira vez para um HEAD (CI verde, nenhuma revisão
ainda âncorada) — não é um estado novo no controller, é o ponto em que o
watcher passa a agir em vez de só observar.

### `rick-loop-preflight.mjs` (novo)

Checagens mecânicas, sem LLM, executadas antes de qualquer disparo:

- `detectStateDrift` (reaproveitado) retorna lista vazia — STATE, HANDOFF e
  os fatos do PR/git concordam.
- `docs/operations/LOOP-REGISTER.jsonl` é JSONL válido linha a linha (mesma
  checagem que este próprio trabalho já vem fazendo manualmente a cada
  append).
- `docs/operations/STATE.md` e `docs/operations/HANDOFF.md` são parseáveis
  por `parseFlatYaml` e não estão vazios.
- O PR tem base `main`, não é draft, e `mergeable` não é `CONFLICTING`.

Saída: `{ pass: boolean, checks: {...}, reasons: string[] }`. Uma checagem
que não pode ser avaliada (por exemplo `gh` indisponível) conta como falha,
nunca como passagem silenciosa — mesmo padrão *fail-closed* que
`evaluateMergeAllowed` já usa.

### `rick-loop-review-dispatch.mjs` (novo)

Dado um número de PR:

1. Resolve `headRefOid`/`headRefName` exatos via `gh pr view <n> --json
   headRefOid,headRefName,baseRefName,isDraft,mergeable,state`.
2. Exige CI (`Validate`) `completed`/`success` para esse HEAD exato
   (mesma consulta que `ciForSha` já faz).
3. Exige `rick-loop-preflight.mjs` `pass: true`.
4. Checagem barata de idempotência (não é a garantia de corretude — ver
   abaixo): `gh run list --workflow claude-pr-review.yml --branch
   <headRefName> --json databaseId,headSha,status,conclusion` — se já
   existe **qualquer** execução para esse HEAD exato (`status` for o que
   for), não dispara de novo. Como `gh workflow run` é assíncrono (não
   retorna o id da execução criada) e essa leitura pode não enxergar uma
   execução que acabou de ser disparada por outro ciclo, esta checagem
   evita a maioria dos disparos redundantes mas **não** é, sozinha,
   suficiente para garantir exatamente uma execução — quem garante isso é
   o grupo de concorrência do workflow, mesma granularidade por PR de hoje
   (ver "Grupo de concorrência", `cancel-in-progress: true`): se dois
   disparos para o mesmo HEAD passarem por esta checagem antes de qualquer
   um aparecer em `gh run list`, os dois são enfileirados no mesmo grupo
   (mesma PR), mas apenas o último chega a **completar** — o anterior é
   cancelado pelo próprio GitHub. AC6 é sobre isso: nunca duas execuções
   *completam* para o mesmo HEAD, não que uma segunda nunca chegue a ser
   enfileirada.
5. Se as condições 1–4 passarem, dispara `gh workflow run
   claude-pr-review.yml --ref <headRefName> -f pr_number=<n> -f
   expected_head_sha=<sha>`. `--ref` é obrigatório: sem ele, `gh workflow
   run` executa contra o branch padrão do repositório (confirmado via `gh
   workflow run --help`), a execução resultante fica gravada com
   `head_branch=main`, e nem a checagem de idempotência do passo 4 nem o
   `retryClaudeReview`/`selectClaudeReviewRun` existente (que filtra por
   `--branch <branch>` e casa `headSha`) jamais a encontram — o watcher
   dispara de novo a cada ciclo, sem fim. Retry de uma execução existente
   que falhou continua sendo `retryClaudeReview` (inalterado), não este
   script.

Cada condição não satisfeita é reportada por nome (`ci_not_green`,
`preflight_failed`, `already_dispatched`, `pr_not_open`, `draft`,
`conflicting`), nunca como uma falha genérica — o watcher e um humano lendo
o log precisam saber qual passo bloqueou sem adivinhar.

### `.github/workflows/claude-pr-review.yml`

`on:` ganha `workflow_dispatch` com `inputs.pr_number` e
`inputs.expected_head_sha`, ambos `required: true`.

**Guarda do job.** O `if:` atual do job (`github.event.pull_request.draft ==
false && github.event.pull_request.head.repo.full_name == github.repository`)
depende de campos que não existem no payload de um evento
`workflow_dispatch`, então precisa virar um `if:` que ramifica por
`github.event_name`: para `pull_request`, a checagem de draft/fork
permanece igual; para `workflow_dispatch`, o job roda incondicionalmente e a
checagem de draft/fork/estado é feita **dentro** do job (próximo item),
porque só aí existe um `gh pr view` para consultar.

**Resolução e revalidação do HEAD.** Um passo novo, antes do checkout,
resolve `pr_number`/`expected_head` de `github.event.pull_request.*` (evento
`pull_request`) ou de `inputs.*` (evento `workflow_dispatch`), e então roda
`gh pr view <pr_number>` para conferir, contra o estado **atual** do PR no
GitHub — não contra o que foi resolvido no passo anterior — que: o PR está
`OPEN`, não é draft, não é de um fork (repositório do HEAD igual ao do
destino), e `headRefOid` ainda é exatamente o HEAD esperado. Isso cobre dois
casos que o design original não cobria: o guard de job re-implementado para
`workflow_dispatch`, e a corrida em que um push novo chega entre o
dispatcher resolver o HEAD e o job realmente começar a rodar (o
`workflow_dispatch` é enfileirado, não instantâneo). Se qualquer checagem
falhar, o job termina sem fazer checkout nem publicar comentário nenhum —
um HEAD que já mudou não deve gerar um veredito sobre o commit errado, e o
watcher vai disparar de novo para o HEAD novo no próximo ciclo. Os passos de
checkout e revisão usam o HEAD revalidado, não o valor bruto do evento ou
do input.

O restante do job (checkout, prompt, `claude_args` incluindo
`--max-turns 50`) usa os valores resolvidos/revalidados em vez de
`github.event.pull_request.*` diretamente, para que o prompt continue
citando `PR NUMBER`/`EXACT HEAD` corretos nos dois casos.

**Grupo de concorrência.** A granularidade **não muda** — continua por PR,
não por HEAD — mas a expressão precisa mudar, e não pode ser resolvida no
passo de resolução dentro do job: o bloco `concurrency:` de nível de
workflow é avaliado pelo GitHub no momento do disparo, antes de qualquer
job/step rodar, e só enxerga os contextos `github`, `inputs` e `vars` —
nunca uma saída calculada dentro de um step. A expressão atual,
`claude-pr-review-${{ github.event.pull_request.number }}`, resolve para o
mesmo grupo (sufixo vazio) em **toda** execução disparada por
`workflow_dispatch`, de qualquer PR, porque `github.event.pull_request` não
existe nesse payload — depois da PR 2, quando todo disparo é
`workflow_dispatch`, isso juntaria revisões de PRs diferentes no mesmo
grupo e uma cancelaria a outra, o oposto de "por PR". A correção é trocar a
expressão para `claude-pr-review-${{ github.event.pull_request.number ||
inputs.pr_number }}` — `inputs` é um dos contextos disponíveis num
`concurrency:` de nível de workflow, então isso resolve certo nos dois
tipos de evento sem depender de nenhum step. A primeira versão desta
seção propunha estreitar o grupo para incluir o HEAD
(`claude-pr-review-<pr_number>-<head>`), o que resolveria a corrida do
passo 4 do dispatcher, mas tem um efeito colateral que a revisão da spec
pegou: hoje, quando um HEAD novo chega enquanto a revisão de um HEAD
anterior ainda está rodando, os dois caem no mesmo grupo (só PR) e
`cancel-in-progress: true` cancela a revisão do HEAD velho — ela nunca
termina de rodar, e o gasto que essa revisão representaria não acontece.
Estreitar o grupo por HEAD quebra exatamente esse comportamento: a revisão
do HEAD velho passaria a rodar até o fim mesmo depois de superada,
reintroduzindo o gasto redundante que ARCH-04 existe para eliminar — o
oposto do objetivo desta task.

Mantendo o grupo por PR apenas, **as duas garantias saem de graça, do
mesmo mecanismo**: duas execuções disparadas por engano para o **mesmo**
HEAD (a corrida do passo 4) caem no mesmo grupo e só a última sobrevive —
ainda válida, porque é para o mesmo HEAD; e uma execução para um HEAD
**novo** cancela a execução ainda rodando de um HEAD **anterior**, que é o
comportamento de hoje e o que evita o gasto redundante. Não há troca entre
as duas propriedades — só existe se o grupo for estreitado por HEAD, o que
esta versão do spec não faz mais.

O gatilho `pull_request` **permanece presente** durante a PR 1 (ver
sequência de bootstrap) e só é removido na PR 2, depois que o caminho novo
estiver provado.

**Por que isso preserva `retryClaudeReview` inalterado.** Uma vez que o
disparo usa `-r/--ref <branch-do-PR>` (ver dispatcher, abaixo), GitHub
grava a execução com `head_branch = <branch-do-PR>` e `head_sha` = a ponta
dessa branch no momento do disparo — os mesmos dois campos que
`gh run list --branch <branch>` e `selectClaudeReviewRun` (`headSha ===
head`) já usam hoje para casar uma execução com o PR/HEAD certos
(`rick-loop-watcher.mjs:20-23`). Sem `--ref`, a execução ficaria gravada
contra o branch padrão (`main`) e nunca seria encontrada por essa consulta
— era esse o defeito na primeira versão deste spec.

### `rick-loop-watcher.mjs`

`retryClaudeReview` (ou uma função irmã) passa a tratar
`action === "NO_RUN"`: em vez de devolver o resultado sem agir, chama
`rick-loop-review-dispatch.mjs` para a PR/HEAD identificados. Chamá-lo em
todo ciclo do watcher enquanto não houver execução visível é seguro — a
checagem barata do dispatcher evita a maioria dos disparos repetidos, e o
grupo de concorrência do workflow garante que mesmo uma corrida entre
ciclos nunca resulta em duas execuções completas para o mesmo HEAD (ver
"Grupo de concorrência" acima).

### Sequência de bootstrap (Requisito 9 do owner)

Duas PRs, nesta ordem:

**PR 1 — aditiva.** Adiciona `workflow_dispatch` ao workflow (o gatilho
`pull_request` continua ativo), adiciona os dois scripts novos, estende o
watcher, adiciona os testes determinísticos. A própria revisão da PR 1
continua saindo pelo gatilho automático existente — nada foi removido
ainda, então o risco de regressão no gate de revisão é zero. Prova o
mecanismo novo de duas formas que não competem com o gatilho automático:
os testes determinísticos (unitários, sem rede) e um disparo manual real
de `workflow_dispatch` nesta mesma PR *depois* que a revisão automática já
tiver sido publicada — confirmando que o input plumbing (checkout do SHA
certo, prompt com PR/HEAD corretos) funciona de ponta a ponta, sem ainda
depender dele para o merge da PR 1.

**PR 2 — o corte.** Remove `pull_request: [opened, synchronize,
ready_for_review, reopened]` do workflow, deixando só `workflow_dispatch`.
Atualiza a narrativa do skill e `loop_version`. A revisão da própria PR 2
só pode vir pelo caminho novo — é disparada manualmente rodando
`node scripts/rick-loop-review-dispatch.mjs <n>` depois que o CI da PR 2
estiver verde. Um push trivial adicional à PR 2 depois disso, seguido da
confirmação de que **nenhuma** execução nova de `claude-pr-review.yml`
aparece até o dispatcher ser chamado de novo, é o teste de aceitação ao
vivo exigido pelo owner (AC10).

## Fronteiras

É **proibido**:

- Enfraquecer o gate de merge obrigatório (`evaluateMergeAllowed` e tudo que
  ele consome) de qualquer forma.
- Qualquer comando manual `@claude review` como substituto do disparo
  automático do controller.
- Remover o gatilho `pull_request` antes da PR 1 estar mergeada com seus
  testes determinísticos verdes.
- Mudar `--max-turns 50` ou o contrato de texto do comentário
  (`Reviewed commit: ...` / `No major issues found.` / `Review result:
  FINDINGS`) que o gate de merge faz parsing.
- Tocar em código de produto, schema, migration ou rota.

## Casos de borda

1. Push antes do CI terminar → nenhum disparo; o watcher só age quando
   `WAIT_FOR_CODEX` aparece, que exige `ci.conclusion === "success"`.
2. CI falha e é corrigido → HEAD muda, CI verde de novo no HEAD novo,
   preflight roda de novo, dispatcher vê que não existe execução para o
   HEAD novo e dispara — o HEAD velho nunca ganha uma revisão que seria
   descartada de qualquer forma.
3. Revisão publica achados → push de correção muda o HEAD; o dispatcher vê
   "nenhuma execução para este HEAD" e dispara de novo, exatamente como o
   `synchronize` fazia antes, só que depois do CI passar em vez de
   imediatamente.
3.1. Push de correção chega **enquanto a revisão do HEAD anterior ainda
   está rodando** (CI do HEAD novo termina antes da revisão do HEAD velho
   terminar) → o dispatcher dispara para o HEAD novo assim que CI+preflight
   passarem nele; como o grupo de concorrência é por PR, não por HEAD, essa
   nova execução cai no mesmo grupo da que ainda está rodando para o HEAD
   velho e a cancela — o gasto de terminar uma revisão já superada não
   acontece, igual ao comportamento de hoje.
4. A Action falha por erro de infraestrutura (não publica veredito) → já
   existe uma execução para aquele HEAD (mesmo com falha); o dispatcher não
   duplica, e o caminho de retry existente (`RERUN`, cooldown de uma hora)
   continua responsável por tentar de novo.
5. Dois ciclos do watcher rodam perto um do outro para o mesmo HEAD → o
   caso comum é o segundo ver a execução que o primeiro acabou de criar e
   não disparar de novo; no caso raro em que os dois disparam antes de
   qualquer um aparecer em `gh run list`, o grupo de concorrência do
   workflow cancela o que entrou primeiro e só o último completa — em
   nenhum dos dois casos duas execuções chegam a completar para o mesmo
   HEAD.
6. Preflight falha (por exemplo `LOOP-REGISTER.jsonl` com uma linha
   inválida) → nenhum disparo; a falha é reportada por nome e o loop trata
   como `RECOVERABLE_FAILURE`, igual a uma falha de CI.

## Estratégia de testes

**Testes determinísticos** (`scripts/rick-loop-review-dispatch-check.mjs`,
sem rede, dados sintéticos): cada condição do dispatcher isolada
(`ci_not_green`, `preflight_failed`, `already_dispatched`, disparo
permitido), a idempotência (chamar duas vezes com o mesmo HEAD dispara uma
vez só), e o preflight (`STATE`/`HANDOFF` drift, JSONL inválido, cada um
falha sozinho). Roda em `npm test` e em `validate.yml`, como todo outro
`*-check.mjs`.

**Teste de aceitação ao vivo** (AC10, não efêmero como o Playwright de
TASK-14 — este prova infraestrutura, não uma tela, e fica registrado como
evidência, não removido): na PR 2, depois que a revisão for disparada
manualmente uma vez e ficar limpa, um push trivial adicional não deve
gerar nenhuma execução nova de `claude-pr-review.yml` até o dispatcher ser
chamado de novo — confirmado consultando `gh run list --workflow
claude-pr-review.yml` antes e depois do push.

## Critérios de aceite

AC1. `.github/workflows/claude-pr-review.yml` ganha `workflow_dispatch` com
`pr_number` e `expected_head_sha` obrigatórios; o `if:` do job roda
incondicionalmente para `workflow_dispatch` (os campos de draft/fork não
existem nesse evento) e mantém a checagem original para `pull_request`; um
passo dentro do job revalida — contra o estado atual do PR no GitHub, não
contra o valor resolvido do evento — que o PR está aberto, não é draft, não
é de um fork, e que `headRefOid` ainda é exatamente o HEAD esperado antes
de fazer checkout ou invocar o Claude.

AC2. `scripts/rick-loop-preflight.mjs` existe e falha fechado: qualquer
checagem não avaliável conta como reprovação, nunca como aprovação
silenciosa.

AC3. `scripts/rick-loop-review-dispatch.mjs` só dispara quando CI está
verde no HEAD exato, o preflight passa, e a checagem barata de
idempotência não encontra execução para esse HEAD; cada bloqueio é
nomeado; o disparo usa `--ref <branch-do-PR>` (sem isso a execução fica
gravada contra o branch padrão e nunca é encontrada por essa mesma
checagem nem pelo `retryClaudeReview` existente).

AC4. `rick-loop-watcher.mjs` chama o dispatcher quando observa
`WAIT_FOR_CODEX`/`WAIT_FOR_INDEPENDENT_REVIEW` sem execução existente
(`NO_RUN`), preservando o caminho de retry existente (`RERUN`,
`selectClaudeReviewRun` casando por `branch`+`headSha`) inalterado — o que
só continua funcionando porque AC3 exige `--ref`.

AC5. Nenhuma função do gate de merge
(`evaluateMergeAllowed`/`isCleanReviewResult`/`countUnresolvedFindings`/
`selectMergeResult`/`buildAnchoredResults`) é alterada.

AC6. Nunca duas execuções completam para o mesmo HEAD, e nunca duas PRs
diferentes competem pelo mesmo grupo: a checagem barata do dispatcher
evita a maioria dos disparos redundantes, e o grupo de concorrência do
workflow — mesma granularidade por PR de hoje, mas com a expressão
`claude-pr-review-${{ github.event.pull_request.number || inputs.pr_number
}}` (o bloco `concurrency:` de nível de workflow só enxerga `github`,
`inputs` e `vars`, nunca um valor calculado num step, então o fallback
precisa estar na própria expressão) — garante que, mesmo que duas sejam
enfileiradas por uma corrida, só a última a entrar no grupo chega a
completar; o mesmo grupo por PR também garante que a revisão de um HEAD
anterior é cancelada assim que uma revisão de um HEAD mais novo é
enfileirada, em vez de rodar até o fim depois de já estar superada — e que
a revisão de uma PR nunca cancela a de outra.

AC7. `--max-turns 50` e o contrato de texto do comentário de revisão
permanecem exatamente como estão.

AC8. O gatilho `pull_request` só é removido na PR 2, depois que a PR 1
(aditiva, com o gatilho antigo ainda ativo) estiver mergeada com os testes
determinísticos verdes.

AC9. Depois da PR 2, um push isolado para uma PR aberta não dispara nenhuma
execução de `claude-pr-review.yml` — só `node
scripts/rick-loop-review-dispatch.mjs <n>` (via watcher ou manual) dispara.

AC10. O teste de aceitação ao vivo descrito em "Estratégia de testes" é
executado na PR 2 e seu resultado (execuções antes/depois do push trivial)
fica registrado em `docs/evidence/ARCH-04-validation.md`.

AC11. `.claude/skills/loop/SKILL.md` (seção "Review result contract") e
`loop_version` em `STATE.md`/`HANDOFF.md` refletem o mecanismo novo depois
da PR 2 — nenhum documento continua afirmando que o `synchronize`
dispara a revisão automaticamente.

## Validação determinística

`lint`, `typecheck`, `build`, `npm test` (incluindo
`test:rick-loop-review-dispatch`, novo), `test:loop-controller`,
`test:loop-v1.4`, `git diff --check`, varredura de segredos — todos verdes
no HEAD exato de cada PR. `db:*` não se aplica (nenhuma mudança de schema).

## Definition of Done

- AC1–AC9 provados por teste determinístico ou leitura direta do workflow,
  não por inspeção;
- AC10 provado ao vivo na PR 2, com evidência salva;
- AC11 provado por diff dos arquivos citados;
- revisão independente publicada para o HEAD exato de cada PR, sem findings
  em aberto, antes do merge de cada uma;
- validação pós-merge verde no merge head de cada PR antes de fechar
  ARCH-04;
- evidência em `docs/evidence/ARCH-04-validation.md`;
- STATE, HANDOFF, ROADMAP e LOOP-REGISTER reconciliados, com `ARCH-04`
  marcado `[x]` e `status: RESOLVED` só depois que a PR 2 estiver mergeada
  e validada.

## Não escopo

`owner_decision_02_includes` lista oito itens; este spec implementa os dois
que o mecanismo de disparo em si exige (`decide_before resolver gate`, já
fechado nas PRs #33/#35 via `depends_on`; `checagens mecânicas antes da
revisão por LLM`, aqui via `rick-loop-preflight.mjs`). Os outros seis —
`STATE_POINTER_CONSISTENCY` e `BASELINE_POINTER_CONSISTENCY` além do que o
preflight cobre, integridade completa do LOOP-REGISTER, semântica de
`current_task` vs `next_eligible_task` além do que `resolveEffectiveTask`
já faz, reconciliação remote-first como mecanismo novo, e métricas de uso
de revisão — ficam **fora** deste spec, mas não caem silenciosamente: a
revisão da primeira versão deste documento apontou corretamente que excluí-
los sem um item rastreado deixaria ARCH-04 fechar OWNER-02 fechando só uma
fração do que foi autorizado. `ARCH-04` continua cobrindo somente o
mecanismo de disparo — é só essa fração que bloqueia `TASK-15` via
`depends_on`, porque é só essa fração que o owner descreveu com uma
arquitetura exata e uma sequência obrigatória. Os seis itens restantes
passam a ter uma entrada própria, `ARCH-05`, adicionada a
`docs/roadmap/ROADMAP.md` nesta mesma spec — rastreada, com escopo listado,
mas **não bloqueante** (`blocking: false`, sem `depends_on` de nenhuma
task), porque o owner não forneceu uma arquitetura exata para eles e
bloquear TASK-15 com um item ainda não especificado contradiria a instrução
explícita de continuar TASK-15/16/17 depois que ARCH-04 fechar.

## Riscos conhecidos

- **Janela de corte**: entre mergear a PR 1 e mergear a PR 2, os dois
  caminhos coexistem tecnicamente, mas o gatilho automático sempre vence a
  corrida (dispara no `synchronize`, antes do CI terminar), então o
  dispatcher nunca dispara de verdade nesse intervalo — ele só é exercido
  de fato depois que a PR 2 remove o gatilho antigo. Isso é intencional
  (Requisito 9), não um defeito a esconder.
- **`gh workflow run` é assíncrono**: não retorna o `databaseId` da
  execução criada; o dispatcher não pode confirmar imediatamente que o
  disparo "pegou". Isso é exatamente por que a checagem de idempotência do
  passo 4 do dispatcher é só uma otimização barata, não a garantia: quem
  garante que no máximo uma execução *completa* por HEAD é o grupo de
  concorrência do workflow (ver "Grupo de concorrência",
  `cancel-in-progress: true`), que não depende de nenhuma leitura
  assíncrona para funcionar.

## Assumptions explícitas

- **A1**: `gh workflow run` com `--ref <branch-do-PR> -f ...` preenche
  `inputs.*` corretamente e grava a execução com `head_branch`/`head_sha`
  da ponta dessa branch (comportamento padrão da CLI, não configuração
  adicional) — sem `--ref` cairia no branch padrão, que é exatamente o
  defeito corrigido nesta versão do spec.
- **A2**: o token usado pelo controller/watcher (o mesmo `gh` já autenticado
  usado em todo o resto do loop) tem permissão de `actions: write` para
  disparar `workflow_dispatch` — se não tiver, isso aparece como uma falha
  de disparo nomeada, não como um disparo silenciosamente ignorado.
- **A3**: um bloco `concurrency:` de nível de workflow só enxerga os
  contextos `github`, `inputs` e `vars` no momento em que o GitHub avalia o
  disparo — nunca uma saída calculada num job/step, porque nenhum ainda
  rodou. É por isso que o fallback `inputs.pr_number` precisa estar na
  própria expressão de `concurrency.group` (AC6), não resolvido num passo
  dentro do job como a primeira versão desta seção propunha.
