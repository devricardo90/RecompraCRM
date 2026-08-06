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

### LESSON-RCRM-0003 — Fixar a major do Prisma conforme o modelo de conexão

```yaml
id: LESSON-RCRM-0003
status: validated
type: tooling
severity: medium
source_task: TASK-02
symptom: "Prisma 7.9.1 já estava disponível, mas a documentação atual exige driver adapter para conexões diretas."
root_cause: "A stack inicial ainda usa o fluxo Prisma Client clássico com PostgreSQL local e não precisa de adapter nesta task."
fix: "Fixar prisma e @prisma/client em 6.19.0, validar geração, migração e conexão real."
prevention: "Reavaliar a major do Prisma junto com o modelo de runtime e os adapters antes de atualizar."
early_detection: "Confirmar system requirements e executar prisma generate, migrate deploy e health check contra PostgreSQL limpo."
limits: "Revalidar quando a aplicação adotar um runtime serverless/edge ou decidir migrar para Prisma 7+."
evidence: "TASK-02: Prisma Client 6.19.0 gerado, migração 20260806084446 aplicada duas vezes em banco limpo e SELECT 1 aprovado."
```

### LESSON-RCRM-0004 — Modelar unicidade condicional para telefone opcional

```yaml
id: LESSON-RCRM-0004
status: validated
type: data_model
severity: medium
source_task: TASK-03
symptom: "O contrato exige telefone único quando informado, mas não exige telefone para todo cliente."
root_cause: "Uma constraint de unicidade deve rejeitar duplicatas não nulas e preservar a ausência válida do campo."
fix: "Usar phone como String? @unique no Prisma/PostgreSQL e cobrir duplicata informada e múltiplos NULL no teste de persistência."
prevention: "Traduzir qualificadores do SDD (quando informado, quando aplicável) em nullability, índices e testes explícitos."
early_detection: "Inspecionar information_schema/pg_indexes e executar casos com telefone repetido e ausente contra PostgreSQL real."
limits: "Revalidar se o contrato passar a exigir normalização de telefone, unicidade por empresa ou preenchimento obrigatório."
evidence: "TASK-03: Customer_phone_key rejeitou telefone duplicado e dois Customers sem phone foram persistidos no banco limpo."
```

### LESSON-RCRM-0005 — Auditar migrações incrementais após marcador técnico

```yaml
id: LESSON-RCRM-0005
status: validated
type: database_migration
severity: medium
source_task: TASK-03
symptom: "Prisma Migrate gerou uma alteração redundante da sequência de DatabaseMarker ao criar a migração de Customer."
root_cause: "A migração incremental comparou o marcador técnico já materializado com a representação esperada e incluiu uma recriação de sequência que colidia com a migração inicial."
fix: "Preservar a migração inicial, remover somente o bloco redundante da migração nova e provar migrate deploy em banco limpo."
prevention: "Inspecionar cada SQL gerado antes de aplicá-lo e validar a cadeia completa após qualquer ajuste de migração."
early_detection: "Executar migrate dev em banco controlado, revisar o SQL e consultar o histórico _prisma_migrations antes de registrar o resultado."
limits: "Revalidar ao alterar o modelo técnico inicial ou atualizar a versão major do Prisma."
evidence: "TASK-03: migração 20260806151419_add_customer aplicada após correção auditada, em banco existente e em recriação limpa."
```
