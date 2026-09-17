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
  LOOP-REGISTER e as métricas de uso de revisão citadas no
  `owner_decision_02_includes` fora do que o preflight determinístico já
  cobre mecanicamente (ver "Riscos conhecidos" — o restante fica para um
  item de acompanhamento, não bloqueia este).

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

1. Resolve `headRefOid` exato via `gh pr view <n> --json headRefOid,baseRefName,isDraft,mergeable,state`.
2. Exige CI (`Validate`) `completed`/`success` para esse HEAD exato
   (mesma consulta que `ciForSha` já faz).
3. Exige `rick-loop-preflight.mjs` `pass: true`.
4. Verifica idempotência: `gh run list --workflow claude-pr-review.yml
   --branch <branch> --json databaseId,headSha,status,conclusion` — se já
   existe **qualquer** execução para esse HEAD exato (`status` for o que
   for), não dispara de novo. Retry de uma execução existente continua
   sendo `retryClaudeReview` (inalterado), não este script.
5. Se todas as condições passarem, dispara
   `gh workflow run claude-pr-review.yml -f pr_number=<n> -f expected_head_sha=<sha>`.

Cada condição não satisfeita é reportada por nome (`ci_not_green`,
`preflight_failed`, `already_dispatched`, `pr_not_open`, `draft`,
`conflicting`), nunca como uma falha genérica — o watcher e um humano lendo
o log precisam saber qual passo bloqueou sem adivinhar.

### `.github/workflows/claude-pr-review.yml`

`on:` ganha `workflow_dispatch` com `inputs.pr_number` e
`inputs.expected_head_sha`, ambos `required: true`. O job resolve três
valores no topo (`pr_number`, `head_sha`, `head_repo_full_name`) a partir de
`github.event_name`: de `github.event.pull_request.*` quando disparado por
`pull_request`, de `inputs.*` mais um `gh pr view` para o repositório do
HEAD quando disparado por `workflow_dispatch`. O restante do job (checkout,
prompt, `claude_args` incluindo `--max-turns 50`) usa esses valores
resolvidos em vez de `github.event.pull_request.*` diretamente, para que o
prompt continue citando `PR NUMBER`/`EXACT HEAD` corretos nos dois casos.

O gatilho `pull_request` **permanece presente** durante a PR 1 (ver
sequência de bootstrap) e só é removido na PR 2, depois que o caminho novo
estiver provado.

### `rick-loop-watcher.mjs`

`retryClaudeReview` (ou uma função irmã) passa a tratar
`action === "NO_RUN"`: em vez de devolver o resultado sem agir, chama
`rick-loop-review-dispatch.mjs` para a PR/HEAD identificados. O dispatcher é
idempotente por construção (passo 4 acima), então chamá-lo em todo ciclo do
watcher enquanto não houver execução é seguro — não duplica disparo.

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
4. A Action falha por erro de infraestrutura (não publica veredito) → já
   existe uma execução para aquele HEAD (mesmo com falha); o dispatcher não
   duplica, e o caminho de retry existente (`RERUN`, cooldown de uma hora)
   continua responsável por tentar de novo.
5. Dois ciclos do watcher rodam perto um do outro para o mesmo HEAD → o
   segundo vê a execução que o primeiro acabou de criar e não dispara de
   novo (idempotência é uma leitura do GitHub, não um lock local).
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
`pr_number` e `expected_head_sha` obrigatórios, resolvendo PR/HEAD/repo do
evento correto (`pull_request` ou `workflow_dispatch`) sem duplicar lógica.

AC2. `scripts/rick-loop-preflight.mjs` existe e falha fechado: qualquer
checagem não avaliável conta como reprovação, nunca como aprovação
silenciosa.

AC3. `scripts/rick-loop-review-dispatch.mjs` só dispara quando CI está
verde no HEAD exato, o preflight passa, e nenhuma execução já existe para
esse HEAD; cada bloqueio é nomeado.

AC4. `rick-loop-watcher.mjs` chama o dispatcher quando observa
`WAIT_FOR_CODEX`/`WAIT_FOR_INDEPENDENT_REVIEW` sem execução existente
(`NO_RUN`), preservando o caminho de retry existente (`RERUN`) inalterado.

AC5. Nenhuma função do gate de merge
(`evaluateMergeAllowed`/`isCleanReviewResult`/`countUnresolvedFindings`/
`selectMergeResult`/`buildAnchoredResults`) é alterada.

AC6. O disparo é idempotente: chamadas repetidas para o mesmo HEAD nunca
criam uma segunda execução.

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

`STATE_POINTER_CONSISTENCY`/`BASELINE_POINTER_CONSISTENCY` além do que o
preflight cobre mecanicamente, métricas de uso de revisão como painel ou
relatório, `current_task` vs `next_eligible_task` além da semântica que já
existe em `resolveEffectiveTask`, remote-first reconciliation como
mecanismo novo (o controller já lê tudo do GitHub a cada ciclo). Cada um
fica como item de acompanhamento se surgir evidência de que é necessário —
não é assumido aqui.

## Riscos conhecidos

- **Janela de corte**: entre mergear a PR 1 e mergear a PR 2, os dois
  caminhos coexistem tecnicamente, mas o gatilho automático sempre vence a
  corrida (dispara no `synchronize`, antes do CI terminar), então o
  dispatcher nunca dispara de verdade nesse intervalo — ele só é exercido
  de fato depois que a PR 2 remove o gatilho antigo. Isso é intencional
  (Requisito 9), não um defeito a esconder.
- **`gh workflow run` é assíncrono**: não retorna o `databaseId` da
  execução criada; o dispatcher não pode confirmar imediatamente que o
  disparo "pegou". A idempotência do próximo ciclo do watcher (que relê
  `gh run list`) é o que evita um disparo duplicado se a execução ainda não
  aparecer na primeira checagem — não uma resposta síncrona do comando de
  disparo.

## Assumptions explícitas

- **A1**: `gh workflow run` com `-f` preenche `inputs.*` corretamente para
  um workflow no branch padrão do repositório (comportamento padrão da
  CLI, não configuração adicional).
- **A2**: o token usado pelo controller/watcher (o mesmo `gh` já autenticado
  usado em todo o resto do loop) tem permissão de `actions: write` para
  disparar `workflow_dispatch` — se não tiver, isso aparece como uma falha
  de disparo nomeada, não como um disparo silenciosamente ignorado.
