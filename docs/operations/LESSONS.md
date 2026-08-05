# Recompra CRM — Lições Aprendidas

Memória operacional append-only. Consultar antes de cada planejamento.

## Política

- Nova lição começa como `candidate`.
- Somente lição com evidência reproduzível vira `validated`.
- Lições equivalentes são consolidadas.
- Lições incorretas são marcadas `superseded` ou `retired`, nunca apagadas silenciosamente.
- Nunca registrar segredos.

## Lições registradas

### LESSON-RCRM-0001 — Validar compatibilidade de versões major da toolchain

```yaml
id: LESSON-RCRM-0001
status: validated
type: tooling
severity: high
source_task: TASK-01
symptom: "Next.js, ESLint e servidor de desenvolvimento falharam com TypeScript 7.0.2."
root_cause: "A versão major do TypeScript ainda não era compatível com a combinação Next.js 16.2.12 e typescript-eslint 8.66.0."
fix: "Fixar TypeScript 6.0.3 e regenerar o lockfile."
prevention: "Antes de adotar versão major recém-lançada, verificar compatibilidade entre Next.js, TypeScript, ESLint, Prisma e Playwright."
early_detection: "Executar npm install, npm run lint, npm run typecheck e npm run build imediatamente após o bootstrap."
limits: "Aplicável à toolchain registrada nesta task; revalidar ao atualizar majors."
evidence: "CI Validate run 31039356612 e validações locais no HEAD 218df9e."
```

### LESSON-RCRM-0002 — Não antecipar ESLint 10 com plugins incompatíveis

```yaml
id: LESSON-RCRM-0002
status: validated
type: tooling
severity: high
source_task: TASK-01
symptom: "A regra react/display-name falhou com contextOrFilename.getFilename is not a function."
root_cause: "ESLint 10 removeu APIs ainda utilizadas pelo eslint-plugin-react carregado pelo eslint-config-next atual."
fix: "Fixar ESLint 9 e atualizar o package-lock.json."
prevention: "Validar a matriz eslint + eslint-config-next + plugins antes de atualizar a versão major."
early_detection: "Executar npm run lint em um arquivo React mínimo durante a fundação do projeto."
limits: "Reavaliar quando eslint-config-next e eslint-plugin-react declararem suporte ao ESLint 10."
evidence: "lint local PASS e CI Validate run 31039356612 no HEAD 218df9e."
```
