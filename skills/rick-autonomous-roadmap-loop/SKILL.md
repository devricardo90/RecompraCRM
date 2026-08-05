---
name: rick-autonomous-roadmap-loop
description: Executa uma task por loop até concluir o roadmap aprovado, preservando baseline verde, state, handoff, lessons e evidências.
version: "1.0.0-pilot"
---

# Rick Autonomous Roadmap Loop — Recompra CRM

## Ordem obrigatória de leitura

1. `docs/product/PROJECT-SDD.md`
2. `docs/roadmap/ROADMAP.md`
3. `docs/operations/STATE.md`
4. `docs/operations/HANDOFF.md`
5. `docs/operations/LESSONS.md`
6. `docs/operations/LOOP-REGISTER.jsonl`
7. evidências da última task
8. Git e working tree

## Invariantes

- Uma task por loop.
- Um executor por task.
- Nenhum loop começa sobre baseline vermelha ou não reconciliada.
- Nenhuma task termina sem lint, typecheck, testes, build e revisão aplicáveis.
- Interface exige Playwright efêmero direcionado e smoke curto.
- Teste Playwright temporário e seus artefatos são removidos após aprovação; persiste apenas o resumo.
- Teste que passa somente após retry é FLAKY e bloqueia avanço.
- No máximo três ciclos de correção.
- Mudança fora do escopo bloqueia a task.
- Antes do próximo loop: Evidence → HANDOFF → LESSONS → LOOP-REGISTER → ROADMAP → STATE.
- O loop para ao concluir o roadmap em `ROADMAP_COMPLETED_WAITING_HUMAN`.
- O agente não cria o próximo roadmap sem gate humano.

## Ciclo obrigatório

1. Reconciliar SDD, ROADMAP, STATE, HANDOFF, LESSONS, Git e evidências.
2. Certificar baseline com os gates disponíveis.
3. Selecionar a primeira task pendente cujas dependências estejam concluídas.
4. Criar plano com objetivo, escopo, arquivos permitidos, riscos e validações.
5. Implementar somente o plano.
6. Executar validação determinística.
7. Quando houver UI, gerar e executar Playwright efêmero.
8. Executar revisão independente.
9. Corrigir no máximo três vezes; depois registrar BLOCKED e parar.
10. Persistir evidências e atualizar os arquivos operacionais.
11. Marcar a task concluída somente após `VERIFIED_GREEN`.
12. Iniciar automaticamente a próxima task, salvo bloqueio ou fim do roadmap.

## Saída de cada loop

```text
STATUS:
TASK:
ATTEMPT:
BASELINE:
VALIDATION:
PLAYWRIGHT:
REVIEW:
LESSONS:
EVIDENCE:
LAST_COMPLETED_TASK:
NEXT_ELIGIBLE_TASK:
NEXT_ACTION:
```
