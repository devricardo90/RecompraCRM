# Recompra CRM — Lições Aprendidas

Memória operacional append-only. Consultar antes de cada planejamento.

## Política

- Nova lição começa como `candidate`.
- Somente lição com evidência reproduzível vira `validated`.
- Lições equivalentes são consolidadas.
- Lições incorretas são marcadas `superseded` ou `retired`, nunca apagadas silenciosamente.
- Nunca registrar segredos.

## Template

```yaml
id: LESSON-RCRM-0001
status: candidate
type: bug|tooling|architecture|process|security|testing|integration
severity: low|medium|high|critical
source_task: TASK-XX
symptom: ""
root_cause: ""
fix: ""
prevention: ""
early_detection: ""
limits: ""
evidence: ""
```

## Lições registradas

Nenhuma lição registrada ainda.
