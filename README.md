# Recompra CRM

Aplicação mobile-first para pequenos negócios acompanharem clientes recorrentes, vendas, previsões de recompra e estoque.

## Stack

- Next.js 16
- React 19
- TypeScript estrito
- Tailwind CSS 4
- ESLint
- Prisma 6.19.0
- PostgreSQL 16 via Docker Compose

## Desenvolvimento local

Requisito: Node.js 20.9 ou superior.

```bash
npm install
npm run dev
```

A aplicação ficará disponível em `http://localhost:3000`.

## Banco local

Requisitos: Docker Desktop com Docker Compose v2 e Node.js 20.9 ou superior.

Crie o arquivo local de ambiente a partir do exemplo (o arquivo `.env` não é versionado):

```bash
cp .env.example .env
```

No PowerShell, use `Copy-Item .env.example .env`.

Inicie o PostgreSQL, gere o cliente Prisma, aplique as migrações versionadas e valide a conexão:

```bash
npm run db:setup
```

Os comandos individuais são:

```bash
npm run db:up          # inicia PostgreSQL e aguarda o health check
npm run db:generate    # gera o Prisma Client
npm run db:validate    # valida prisma/schema.prisma
npm run db:migrate     # aplica migrações existentes sem gerar novas
npm run db:health      # executa SELECT 1 usando uma conexão real
npm run test:customer  # valida persistência e constraints do Customer
npm run test:product   # valida persistência e constraints do Product
npm run test:product-api # valida a API Product contra o PostgreSQL real
npm run db:down        # para o container, preservando o volume local
```

O modelo `Customer` exige `name`. O campo `phone` é opcional e possui unicidade
somente quando informado, conforme o contrato do SDD. A migração do modelo é
versionada em `prisma/migrations/` e o teste de persistência usa o PostgreSQL
local configurado por `DATABASE_URL`.

O modelo `Product` exige `name`, `unit`, `currentStock`, `minimumStock` e
`consumptionDays`. Estoque atual e mínimo não podem ser negativos, a duração
de consumo deve ser positiva e nome/unidade não podem ser somente whitespace.
As operações de venda, alertas e interface de produtos permanecem nas tasks
posteriores.

A interface de produtos fica disponível em `http://localhost:3000/products` e
permite cadastro, edição, busca, estados vazios/erro e sinalização de estoque
menor ou igual ao mínimo. A redução automática de estoque continua reservada
às tasks de venda.

Para recriar o banco local do zero durante uma validação, use `docker compose down -v` e depois `npm run db:setup`. Esse comando remove apenas o volume local do Compose e não deve ser usado contra ambientes compartilhados.

`DATABASE_URL` e os parâmetros do PostgreSQL estão documentados em `.env.example`. A senha do exemplo é exclusiva para desenvolvimento local e não representa uma credencial real.

## Gates de qualidade

```bash
npm run lint
npm run typecheck
npm run build
```

## Rick Loop

A execução do MVP é controlada por:

- `docs/product/PROJECT-SDD.md`
- `docs/roadmap/ROADMAP.md`
- `docs/operations/STATE.md`
- `docs/operations/HANDOFF.md`
- `docs/operations/LESSONS.md`
- `skills/rick-autonomous-roadmap-loop/SKILL.md`
