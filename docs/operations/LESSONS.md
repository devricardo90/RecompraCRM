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

### LESSON-RCRM-0006 — Persistir invariantes de conteúdo no banco

```yaml
id: LESSON-RCRM-0006
status: validated
type: data_model
severity: high
source_task: TASK-03-P2-FIX
symptom: "Customer.name rejeitava NULL, mas aceitava string vazia e whitespace sem conteúdo."
root_cause: "Nullability não expressa a regra semântica de que o nome deve conter ao menos um caractere não whitespace."
fix: "Adicionar constraint PostgreSQL Customer_name_not_blank usando expressão POSIX [^[:space:]] e cobrir casos inválidos no teste de persistência."
prevention: "Para invariantes de conteúdo, combinar validação de entrada futura com constraint persistente e teste contra PostgreSQL real."
early_detection: "Testar vazio, espaços, tabs e quebras de linha, não apenas NULL, durante a primeira modelagem da entidade."
limits: "Revalidar se a regra passar a exigir normalização, trim automático, comprimento mínimo ou política de nomes diferente."
evidence: "TASK-03 P2: migração 20260806204721_enforce_customer_name aplicada em banco vazio; npm test rejeitou os quatro formatos sem conteúdo."
```

### LESSON-RCRM-0007 — Tornar CHECK constraints seguras para dados legados

```yaml
id: LESSON-RCRM-0007
status: validated
type: database_migration
severity: critical
source_task: TASK-03-P1-FIX
symptom: "Uma CHECK adicionada já validada pode abortar o deploy quando o banco existente contém linhas legadas inválidas."
root_cause: "A migration não separava enforcement de novos dados da validação retroativa do conjunto legado."
fix: "Adicionar a CHECK como NOT VALID, aplicar a regra a novos INSERT/UPDATE e executar VALIDATE CONSTRAINT apenas quando a consulta de inválidos retornar zero linhas."
prevention: "Avaliar sempre o estado dos dados existentes antes de validar constraints novas em migrations incrementais."
early_detection: "Testar banco limpo e banco legado com linha inválida preservada, além de consultar pg_constraint.convalidated."
limits: "A constraint NOT VALID exige remediation aprovada dos dados legados antes de uma validação definitiva."
evidence: "Harness scripts/customer-migration-compat-check.mjs criado e limitado às migrations anteriores à migration alvo; Validate #26 run 31306424995 concluiu SUCCESS na main 44ae41746869f5dcf439f8903ff4d6be254aab9a, com cenários A/B e migration compatibility PASS."
```

### LESSON-RCRM-0008 — Alinhar ranges numéricos da API aos tipos do banco

```yaml
id: LESSON-RCRM-0008
status: validated
type: input_validation
severity: high
source_task: TASK-06
symptom: "Number.isInteger aceitava valores acima do range PostgreSQL INTEGER, convertendo entrada inválida em erro Prisma/HTTP 503."
root_cause: "A validação aplicava somente integralidade e limite mínimo, sem refletir o limite superior do tipo persistido, inclusive para IDs de rota."
fix: "Aplicar o máximo 2147483647 a currentStock, minimumStock, consumptionDays e Product.id; manter os mínimos do domínio; cobrir POST e PUT contra PostgreSQL real."
prevention: "Ao validar números de API, derivar limites inferiores do domínio e limites superiores do tipo de persistência, incluindo path parameters."
early_detection: "Adicionar casos imediatamente acima do limite do banco e confirmar resposta 400 antes da chamada Prisma."
limits: "Revalidar se os campos migrarem para BIGINT, Decimal ou outro tipo de armazenamento."
evidence: "TASK-06: Product API integration local PASS; Validate #46 run 31325836264 SUCCESS no head técnico 7e1c9670535421af7bfce2e040bf306a2e783a08; Validate #49 run 31328149760 SUCCESS na main mergeada c9cb0fba8a907ce46d385c2e03fa7411b48c03c8."
```

### LESSON-RCRM-0009 — Propagação bidirecional entre tabelas exige exclusão mútua de direções, não um mutex global

```yaml
id: LESSON-RCRM-0009
status: validated
type: concurrency
severity: high
source_task: TASK-09
symptom: "Triggers de propagação pai->filho (Product.consumptionDays e Sale.soldAt recalculando SaleItem) fecharam ciclos de deadlock com o caminho filho->pai já existente (leitura de previsão, estoque da TASK-08 e guarda de itens da TASK-07)."
root_cause: "Cada par de tabelas passou a ser travado nas duas ordens. A linha do pai já está travada pelo statement cujo trigger AFTER propaga, e a linha do filho pelo statement cujo trigger BEFORE lê o pai, então não sobra ponto onde reordenar row locks."
fix: "Tomar um advisory lock transacional em trigger BEFORE ... FOR EACH STATEMENT - o único ponto que antecede todo row lock - em modo shared para escritas do filho e exclusive apenas para os statements do pai que propagam, armados por UPDATE OF da coluna propagante."
prevention: "Ao adicionar propagação pai->filho onde já existe escrita filho->pai, mapear o grafo de ordens de lock antes de implementar e excluir mutuamente as direções, preservando concorrência dentro de cada direção."
early_detection: "Escrever um harness que reconstrói o banco sem a correção, reproduz o ciclo com um terceiro transaction pinando uma linha via SELECT ... FOR UPDATE (que não dispara triggers) e exige 40P01; depois exigir commit limpo com a correção."
limits: "Um mutex exclusivo global remove os deadlocks mas serializa transações inteiras e trava padrões legítimos em que duas transações precisam escrever antes de qualquer commit - foi tentado na TASK-09 e rejeitado por travar o caso concorrente da TASK-07. Resta o caso de uma única transação que escreve SaleItem e também altera consumptionDays/soldAt: ela pediria exclusive segurando shared e seria abortada como deadlock normal e retentável; nenhuma rota da aplicação faz essa combinação."
evidence: "TASK-09: scripts/sale-forecast-lock-order-check.mjs reproduz os dois ciclos antes da migration 20260819140000_serialize_forecast_lock_order e exige commit correto depois; gates locais completos PASS incluindo test:sale (caso concorrente da TASK-07)."
```

### LESSON-RCRM-0010 — Propagação pai->filho reabre ciclos a cada mutação suportada

```yaml
id: LESSON-RCRM-0010
status: validated
type: concurrency
severity: high
source_task: TASK-09
class: REVIEW_FINDING
symptom: "Seis ciclos de deadlock distintos apareceram em rodadas sucessivas na mesma malha de triggers: Product<->SaleItem, Sale<->SaleItem, movimentação cruzada de itens em direções opostas, escrita vs exclusão, e reatribuição de productId deixando o produto antigo travado depois da Sale."
root_cause: "Cada mutação suportada de SaleItem (INSERT, quantity, productId, saleId, DELETE) toca um conjunto diferente de linhas pai, e cada correção anterior ordenava apenas o subconjunto conhecido naquela rodada."
fix: "Ordem global de locks na direção filho: todo Product que o statement toca, por id crescente, e só então toda Sale que ele toca, por id crescente. A direção pai fica mutuamente exclusiva via advisory lock exclusive contra o shared dos filhos."
prevention: "Antes de adicionar propagação pai->filho, enumerar TODAS as mutações suportadas do filho e, para cada uma, o conjunto de linhas pai que os triggers existentes tocarão - inclusive as tocadas por triggers AFTER e por constraint triggers deferred."
early_detection: "Para cada mutação suportada, escrever um caso concorrente contra a exclusão e contra a mutação inversa antes de considerar a task pronta."
limits: "A ordem é garantida por linha afetada, não por statement nem por transação; ver LESSON-RCRM-0013."
evidence: "TASK-09 rodadas 3 a 7; migrations 20260819140000, 20260819160000, 20260819180000, 20260819200000, 20260819220000; scripts/sale-forecast-lock-order-check.mjs."
```

### LESSON-RCRM-0011 — Snapshot REPEATABLE READ obsoleto persiste valor derivado errado

```yaml
id: LESSON-RCRM-0011
status: validated
type: concurrency
severity: high
source_task: TASK-09
class: REVIEW_FINDING
symptom: "Uma transação REPEATABLE READ cujo snapshot precede um commit de correção de Sale.soldAt inseria um item e gravava a previsão calculada com a data antiga; a propagação do pai não conseguia corrigir a linha porque ela ainda não estava ligada à venda quando a propagação rodou."
root_cause: "Exclusão mútua no tempo (advisory lock) não cobre o caso em que o pai JÁ commitou: não há sobreposição a excluir, e a leitura simples continua servindo o snapshot antigo."
fix: "Ler a linha pai com um row lock que conflite com UPDATE não-chave (FOR NO KEY UPDATE), o que faz o PostgreSQL levantar 40001 para o escritor obsoleto em vez de aceitar o valor errado."
prevention: "Campo derivado calculado a partir de outra tabela exige leitura com lock que conflite com a atualização daquela tabela, não apenas exclusão temporal entre caminhos."
early_detection: "Testar explicitamente: fixar snapshot RR, commitar a alteração do insumo, e só então escrever o filho."
limits: "FOR KEY SHARE não serve para insumo alterado por UPDATE não-chave; ver LESSON-RCRM-0012."
evidence: "TASK-09 rodada 5; migration 20260819180000_order_sale_locks_for_forecast."
```

### LESSON-RCRM-0012 — Sugestão de revisor é hipótese: FOR KEY SHARE reprovado pelo banco real

```yaml
id: LESSON-RCRM-0012
status: validated
type: process
severity: medium
source_task: TASK-09
class: REVIEW_FINDING
symptom: "O revisor apontou corretamente o defeito de snapshot obsoleto e recomendou reter uma leitura com lock compatível, especificamente FOR KEY SHARE, alegando que forçaria falha de serialização sem bloquear o UPDATE não-chave diferido."
root_cause: "A correção de Sale.soldAt é um UPDATE não-chave; FOR KEY SHARE conflita apenas com FOR UPDATE. O PostgreSQL trava a versão mais nova sem levantar nada e o snapshot obsoleto continua sendo servido."
fix: "Implementar a sugestão, provar contra banco real que ela não fecha o defeito, rejeitá-la e adotar FOR NO KEY UPDATE com ordem de locks fixa, que satisfaz simultaneamente a rodada anterior e esta."
prevention: "Diagnóstico do revisor e remédio do revisor são coisas separadas. Aceitar o diagnóstico quando reproduzido; submeter o remédio ao mesmo teste de evidência que qualquer outra hipótese."
early_detection: "O harness pré/pós-correção acusou na primeira execução: a reprodução pré-correção passou e a asserção pós-correção falhou."
limits: "Não generaliza para revisores humanos com contexto de domínio não codificado no repositório; o critério continua sendo evidência, não autoridade."
evidence: "TASK-09 rodada 5; comentário de revisão 3814013346; correção registrada no PR #14."
```

### LESSON-RCRM-0013 — Ordem de locks por linha não é garantia por statement

```yaml
id: LESSON-RCRM-0013
status: validated
type: concurrency
severity: medium
source_task: TASK-09
class: ACCEPTED_RESIDUAL
symptom: "A migration afirmava ordem de locks válida para o statement inteiro, mas um trigger FOR EACH ROW só ordena o que aquela linha toca; um statement multi-linha pode travar uma Sale para a primeira linha e só então alcançar um Product para a segunda."
root_cause: "Trigger de linha não conhece o conjunto de linhas do statement, e o PostgreSQL expõe transition tables apenas para triggers AFTER, quando os locks já foram tomados."
fix: "Corrigir a afirmação para o escopo real (por linha) e aceitar o residual explicitamente: falha 40P01 retentável em escrita multi-item de SaleItem."
prevention: "Declarar o escopo exato de uma garantia de concorrência. Uma afirmação larga demais é dívida: some na revisão seguinte e custa uma rodada."
early_detection: "Perguntar de qual objeto a garantia é propriedade - linha, statement ou transação - antes de escrevê-la no comentário da migration."
limits: "Serializar statements filhos fecharia o residual mas reintroduz o mutex global rejeitado em LESSON-RCRM-0014. Contratado na TASK-10: forma segura de mutação e/ou retry limitado."
evidence: "TASK-09 rodadas 7 e 8; migration 20260819220000; docs/specs/TASK-10.md."
```

### LESSON-RCRM-0014 — Mutex global remove deadlock e quebra concorrência exigida

```yaml
id: LESSON-RCRM-0014
status: validated
type: concurrency
severity: high
source_task: TASK-09
class: AGENT_FAILED_ATTEMPT
symptom: "A primeira tentativa de fechar os dois primeiros ciclos usou um advisory lock exclusive em todo statement do cluster Sale/SaleItem/Product. Os deadlocks sumiram e o harness da TASK-07 travou indefinidamente."
root_cause: "O caso da TASK-07 exige que duas transações executem cada uma a sua remoção de item antes de qualquer commit. Um lock exclusive mantido até o commit torna esse encontro impossível por construção: a segunda transação fica presa esperando a primeira commitar, e a primeira espera a segunda escrever."
fix: "Não foi enviado. Substituído por shared para escritas de SaleItem e exclusive apenas para os dois statements pai que propagam, armados por UPDATE OF da coluna propagante para não forçar upgrade shared->exclusive vindo de dentro do caminho filho."
prevention: "Antes de introduzir exclusão mútua, verificar quais padrões de concorrência JÁ são exigidos por tasks concluídas. Uma correção que passa nos testes novos e trava um teste antigo não é uma correção."
early_detection: "Rodar a suíte completa, não apenas o harness da correção. O travamento apareceu como npm test parado, diagnosticado por pg_stat_activity: idle in transaction segurando o advisory, outro backend esperando por ele."
limits: "Registrado como tentativa reprovada do próprio agente, não como finding de revisão; nenhuma implementação com mutex global foi enviada."
evidence: "TASK-09 rodada 3, pré-push; diagnóstico via pg_stat_activity; substituída por 20260819140000_serialize_forecast_lock_order."
```

### LESSON-RCRM-0015 — Overflow de interval precede overflow de timestamp em backfill legado

```yaml
id: LESSON-RCRM-0015
status: validated
type: migration_safety
severity: high
source_task: TASK-09
class: REVIEW_FINDING
symptom: "Com quantity e consumptionDays ambos no teto de INTEGER - combinação aceita pelas constraints existentes - a contagem de dias chega a 4.6e18 e o cast para interval falha com interval_field_overflow (22015) ANTES que a soma possa falhar com datetime_field_overflow (22008). O handler cobria só o segundo, então o backfill abortava o deploy para dados legais antes da TASK-09."
root_cause: "O tratamento de overflow foi desenhado olhando o limite do tipo de destino (timestamp) e não o limite do tipo intermediário (interval) usado no cálculo."
fix: "Capturar as duas condições no mesmo handler. A correção foi feita dentro de 20260811130000, a própria migration cujo backfill é o chamador que falha - uma migration posterior nunca chegaria a rodar."
prevention: "Ao converter valores para calcular, enumerar os limites de TODOS os tipos intermediários, não só o do resultado."
early_detection: "Semear dados legados nos extremos aceitos pelas constraints e exigir que a cadeia completa de migrations faça deploy sobre eles."
limits: "Corrigir a migration já aplicada exige reconciliar checksum em bancos de desenvolvimento; aceitável porque a branch nunca foi implantada em ambiente persistente."
evidence: "TASK-09 rodada 8; confirmado nos dois sentidos: revertendo o handler o deploy aborta com 22015."
```

### LESSON-RCRM-0016 — Campo derivado precisa ser inescrevível, não só calculado

```yaml
id: LESSON-RCRM-0016
status: validated
type: data_integrity
severity: medium
source_task: TASK-09
class: REVIEW_FINDING
symptom: "expectedRepurchaseAt era gravável diretamente: o trigger disparava em INSERT e em UPDATE OF quantity/productId/saleId, mas não em atualizações da própria coluna, enquanto o schema Prisma a expõe como campo gravável. Um caller que atualizasse só essa coluna persistia valor arbitrário, que sobrevivia até algum insumo da fórmula mudar."
root_cause: "A lista de colunas do trigger enumerava os insumos da fórmula e esquecia o próprio resultado."
fix: "Incluir a coluna derivada na lista do trigger, recalculando em vez de rejeitar - os dois triggers de propagação atualizam essa mesma coluna e rejeitar os quebraria. Feito em migration posterior e separada, porque a mesma lista vale enquanto 20260811130000 roda o backfill legado, que é ele próprio um UPDATE dessa coluna."
prevention: "Ao criar coluna derivada mantida por trigger, incluir a própria coluna entre os eventos que disparam o recálculo."
early_detection: "Testar a escrita direta do campo derivado e exigir que o valor canônico prevaleça."
limits: "Recalcular, e não rejeitar, é o comportamento correto aqui; rejeitar quebraria a propagação."
evidence: "TASK-09 rodada 9; migration 20260820000000_recompute_forecast_on_direct_write."
```
