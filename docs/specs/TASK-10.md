# TASK-10 Spec — Interface de registro de venda

Status: SPEC_DERIVED_NOT_STARTED
Source: `docs/product/PROJECT-SDD.md` + `docs/roadmap/ROADMAP.md`
Depends on: TASK-04 (interface Customer), TASK-06 (interface Product), TASK-09 (previsão de recompra)
Baseline: `e4de101bcbd9d632a72c6a81efb3cf02a7cf0c8d` (main, pós-merge do PR #14)

## Outcome

Permitir registrar uma venda pela interface: escolher o cliente, adicionar um ou
mais produtos com quantidade, confirmar, e ver o resultado refletido em estoque e
previsão de recompra. Fluxo mobile-first.

## In scope

- tela de registro de venda com seleção de cliente e de produtos;
- múltiplos itens por venda, com quantidade por item;
- API de venda que persista `Sale` + `SaleItem` de forma atômica;
- feedback de erro legível para as regras que já existem no banco
  (estoque insuficiente, venda sem itens, quantidade não positiva);
- estados de carregamento, vazio e erro;
- validação mobile-first com Playwright efêmero.

## Out of scope

- histórico do cliente (TASK-11);
- dashboard de recompra (TASK-12);
- dashboard de estoque (TASK-13);
- edição e cancelamento de venda já registrada, salvo o mínimo que o fluxo exigir;
- decidir o ARCH-01 (previsão persistida vs calculada) — este spec não depende do
  desfecho e não deve antecipá-lo.

## Invariantes herdadas (não reimplementar, não contornar)

Estas regras já são garantidas no banco pelas TASK-07/08/09 e a interface deve
apenas respeitá-las e reportá-las:

- uma venda confirmada tem pelo menos um item;
- quantidade é positiva;
- confirmar a venda reduz o estoque atomicamente e nunca o deixa negativo;
- `expectedRepurchaseAt` é derivado: é calculado no banco e reescrito se alguém
  tentar gravá-lo diretamente. A interface **não** envia esse campo;
- `Sale.id` e `Product.id` são imutáveis.

## Contrato de concorrência (obrigatório, decidir antes de implementar)

A TASK-09 deixou um residual aceito e registrado: a ordem de locks da malha de
triggers é uma garantia **por linha afetada**, não por statement nem por
transação. Um statement ou uma transação que escreva vários `SaleItem` pode,
portanto, travar uma `Sale` para uma linha e só então alcançar um `Product` para a
próxima, e uma exclusão concorrente do mesmo produto/venda fecha um ciclo que o
PostgreSQL aborta com `40P01` retentável.

Nenhum caminho atual da aplicação faz isso. A TASK-10 é o primeiro que pode fazer,
porque uma venda com vários itens é o caso normal.

**A implementação não pode começar antes de esta seção registrar a estratégia
escolhida.** Escolher uma das duas, ou ambas:

### Estratégia A — forma de mutação segura

Emitir as mutações de `SaleItem` em uma forma suportada e determinística, em vez
de um statement multi-linha irrestrito. Exige registrar aqui:

- a forma exata emitida (por exemplo, uma linha por statement, em ordem
  determinística de `productId`);
- como isso é garantido no código, e não apenas por convenção;
- o que impede uma regressão silenciosa caso o ORM passe a agrupar as escritas.

### Estratégia B — retry limitado

Implementar retry limitado para falhas de concorrência retentáveis do PostgreSQL:
`40P01` (deadlock) e, quando aplicável, `40001` (falha de serialização). Exige
registrar aqui:

- número máximo de tentativas e política de espera;
- que a transação inteira é refeita, nunca continuada de um estado parcial;
- que apenas esses SQLSTATEs são retentados.

### Regras que valem para qualquer estratégia

- **Não engolir erros de banco.** Um erro não retentável, ou o esgotamento das
  tentativas, deve falhar de forma visível e ser reportado ao usuário; nada de
  `catch` silencioso, e nada de transformar falha em venda parcialmente
  registrada.
- Esgotar o retry é um resultado legítimo e deve produzir mensagem clara.
- A escolha deve ser **provada com um teste de concorrência**, no mesmo padrão
  determinístico das TASK-07/08/09: duas transações concorrentes reproduzindo o
  cenário e exigindo o desfecho contratado, contra PostgreSQL real, sem `sleep`
  como sincronização.

## Done when

- fluxo de registro de venda funciona ponta a ponta pela interface;
- venda multi-item persiste todos os itens atomicamente;
- estoque e previsão refletem a venda;
- erros das invariantes herdadas aparecem de forma legível na interface;
- a estratégia de concorrência está escrita nesta seção **antes** da
  implementação e provada por teste de concorrência determinístico;
- nenhum erro de banco é silenciosamente engolido;
- Validate completo verde;
- Playwright efêmero mobile-first aprovado (obrigatório nesta task: há mudança de
  interface, ao contrário da TASK-09);
- revisão independente sem findings bloqueantes no HEAD exato;
- STATE/HANDOFF/evidence reconciliados antes do merge.
