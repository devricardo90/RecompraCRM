# ARCH-04 — evidência de validação

Escopo: OWNER-02 / REVIEW_TRIGGER_ECONOMICS. Remover a **execução**
automática de revisão Claude a cada push, mantendo intacto o gate de revisão
independente limpa no HEAD exato antes do merge.

Este documento registra o teste de aceitação ao vivo exigido por AC10 e a
"Estratégia de testes" da spec (`docs/specs/ARCH-04.md`). Todos os números de
execução abaixo são de execuções reais, verificáveis via
`gh run view <id>`.

## Cadeia de entrega

| Etapa | PR | Rodadas | HEAD revisado limpo | Merge | Pós-merge Validate |
| --- | --- | --- | --- | --- | --- |
| Spec | #36 | 6 | — | `2f5c687` | 35257845976 SUCCESS |
| PR1 (dispatcher aditivo) | #37 | 10 | `45ddde1` | `3bb1ec1` | 35307171971 SUCCESS |
| Stage 1 (reviewer secundário) | #38 | 3 | `ccc9c49` | `f83b668` | 35342232305 SUCCESS |
| Stage 1b (pointer gate) | #39 | 3 | `f2d60a5` | `f3fc479` | 35344725337 SUCCESS |
| Stage 2 (cutover aditivo) | #40 | 2 | `1c969de` | `1a27df3` | 35347958284 SUCCESS |
| Stage 3 (dispatch-only) | #41 | ver abaixo | — | — | — |

## Teste de aceitação ao vivo (AC9/AC10)

Executado na PR #41, branch `feat/ARCH-04-dispatch-activation`.

### A. Múltiplos pushes não disparam revisão

Seis pushes na PR #41. Execuções de `claude-pr-review.yml` (reviewer
primário) criadas por esses pushes: **zero**. Não "skipped" — nenhuma
execução chegou a ser criada, porque o gatilho `pull_request` não existe mais
na definição do branch.

```
$ gh run list --workflow claude-pr-review.yml \
    --branch feat/ARCH-04-dispatch-activation --json databaseId --jq 'length'
0
```

Dois desses pushes foram sondas deliberadas, sem efeito funcional
(`b5be48f` cria um arquivo-sonda, `a7c1f53` o remove), feitas só para
produzir pushes reais que precisavam não disparar revisão.

### B. Defeito encontrado pelo próprio teste de aceitação

As sondas **reprovaram** a primeira versão da Stage 3. O reviewer primário
não rodou, mas o secundário (`claude-pr-review-meta.yml`) iniciou o modelo
nas duas sondas: execuções **35365924867** e **35365946583**. O filtro
`paths` casa o changeset inteiro da PR, não o push individual, então toda
sincronização de uma PR de infraestrutura de revisão re-revisava tudo.

Isso viola a regra do owner sem qualificação: *a push alone must NEVER invoke
an LLM review*. A execução 35365924867 foi ainda cancelada no meio da
chamada do modelo pelo `concurrency` do push seguinte — custo gasto sem
veredito nenhum, que é exatamente o problema de economia de revisão.

Correção em `6190914`: o secundário também passou a ser dispatch-only. Isso
só é seguro agora porque uma revisão despachada roda a definição do branch
padrão, então a validação de workflow da própria action passa por construção
e o primário despachado consegue revisar PRs que editam
`claude-pr-review.yml` — a falha que tornou o reviewer secundário necessário
na Stage 1. O secundário continua permanentemente disponível para manutenção
autorizada de infraestrutura de revisão; apenas não é mais disparado por
push.

Depois da correção, o push `6190914` produziu **apenas `Validate`**, nenhuma
execução de revisão de nenhum tipo.

### C. Um HEAD autorizado produz exatamente uma revisão

```
$ node scripts/rick-loop-review-dispatch.mjs 41
{ "dispatch": true, "blockers": [], "run_state": "NONE",
  "head": "619091423ad6100ab98b4f85dbe42c5c4466b1d1",
  "ci": { "id": 35366205490, "status": "completed", "conclusion": "success" },
  "dispatched": true,
  "gh_output": "https://github.com/devricardo90/RecompraCRM/actions/runs/35366498301" }
```

Execução **35366498301**:

```
workflow   = Claude PR Review
event      = workflow_dispatch
headBranch = main
headSha    = 1a27df3
run-name   = Claude PR Review · PR #41 @ 619091423ad6100ab98b4f85dbe42c5c4466b1d1
```

Publicou veredito real no HEAD exato: `Reviewed commit:
619091423ad6100ab98b4f85dbe42c5c4466b1d1`, com `num_turns: 45` e
`total_cost_usd: 1.1353646`. Não foi um check verde sem veredito.

Dois fatos importantes nessa linha `headBranch = main`:

1. **A definição executada é a confiável.** `--ref` nomeia o branch cuja
   *versão do arquivo de workflow* roda. O achado P1 da PR #40 era que
   apontá-lo para o branch do PR executaria a cópia do autor do PR, com o
   `CLAUDE_CODE_OAUTH_TOKEN` e escopos de escrita — e com todos os passos de
   validação dentro do mesmo arquivo que o autor pode reescrever. Aqui a
   execução veio de `main`.
2. **A correlação não depende mais de `head_sha`.** O `headSha` gravado é o
   de `main`, não o do PR. O `run-name` carrega o HEAD revisado, e
   `reviewRunMatchesHead` casa por ele.

### D. Dispatch duplicado é impedido

Mesmo HEAD, execução em voo:

```
{ "dispatch": false, "blockers": ["already_dispatched"], "run_state": "IN_FLIGHT" }
```

Mesmo HEAD, veredito já publicado:

```
{ "dispatch": false, "blockers": ["already_reviewed"], "run_state": "REVIEWED" }
```

O primeiro caso é também a prova de que a correlação por `run-name` funciona:
o dispatcher encontrou uma execução cujo `headSha` é o de `main`.

### E. O dispatcher falha fechado

Com `Validate` ainda em andamento no HEAD exato:

```
{ "dispatch": false, "blockers": ["ci_not_green"], "run_state": "NONE",
  "preflight_reasons": [] }
```

CI verde no HEAD exato é pré-condição, não sugestão.

### F. Achados disparam correção e nova revisão

A revisão despachada em C retornou `Review result: FINDINGS` — um P1
(este arquivo não existia, enquanto o comentário do workflow afirmava que
existia) e um P2 (narrativa desatualizada em ROADMAP/HANDOFF). Ambos
corrigidos, seguidos de novo push e nova revisão despachada no novo HEAD.
Nenhum push disparou revisão sozinho em nenhum momento desse ciclo.

## O gate de merge não foi enfraquecido

`evaluateMergeAllowed`, `isCleanReviewResult`, `countUnresolvedFindings`,
`selectMergeResult`, `buildAnchoredResults` e `filterAnchoredCleanComments`
não foram modificados por nenhuma PR desta sequência. Prova ao vivo de que
continuam mandando, da PR #40:

```
MERGE GATE -> allowed: false
  cleanReview: false    zeroUnresolvedFindings: false
```

O reviewer secundário havia publicado `No major issues found.` no HEAD
exato. Um segundo revisor independente encontrou um P1 inline ancorado
naquele mesmo HEAD, e o gate determinístico recusou o merge. Foi o gate — não
o julgamento de um revisor — que impediu o merge.

## Checagens determinísticas antes de invocar o LLM

`scripts/rick-loop-preflight.mjs` roda nove checagens, todas fail-closed, e
nenhuma revisão é despachada sem as nove:

```
state_parseable, handoff_parseable, register_valid_jsonl, no_state_drift,
pr_open, pr_not_draft, pr_base_is_default, pr_not_conflicting,
roadmap_pointers_agree
```

`roadmap_pointers_agree` (PR #39) existe porque a mesma classe de deriva de
ponteiro foi encontrada por revisão independente oito vezes nas PRs #36/#37/
#38. A nona ocorrência foi pega por máquina: o preflight barrou a própria PR
do gate (`no_state_drift`) com CI verde e revisão limpa no HEAD exato.

## Consequência operacional: o check verde deixa de significar revisão

Com os dois workflows dispatch-only, uma execução `workflow_dispatch` nao se
anexa ao PR como check. Depois desta PR, o unico check do PR e o `quality`
(`Validate`). Nada na interface do GitHub fica vermelho se uma revisao estiver
faltando ou tiver retornado FINDINGS.

Isso e o desenho correto — o gate de merge sempre ancorou no **comentario** de
veredito no HEAD exato (`filterAnchoredCleanComments`,
`countUnresolvedFindings`), nunca num check — mas muda o que um humano ve. A
instrucao do owner de que um check verde nao e suficiente passa a valer mais
depois deste merge do que antes: a partir daqui um check verde nao prova
absolutamente nada sobre revisao, e `evaluateMergeAllowed` e a unica coisa
entre um PR e um merge sem revisao.

## Custo

Vereditos despachados nesta PR custaram `total_cost_usd` 1.14 (execução
35366498301). Para comparação, a execução do reviewer secundário cancelada
no meio pelo push seguinte (35365924867) é custo puro sem veredito — a classe
de desperdício que a economia de gatilho elimina.
