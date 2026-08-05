# Recompra CRM — PROJECT SDD

Status: CANÔNICO
Versão: 1.0
Fonte primária: Google Docs — “Fonte da Verdade - Recompra CRM”.

## Objetivo do MVP

Permitir que a usuária cadastre clientes e produtos, registre vendas, tenha o estoque reduzido automaticamente e identifique clientes que devem ser contatados para recompra.

## Regras canônicas principais

- Todo cliente possui nome; telefone é único quando informado.
- Todo produto possui nome, unidade, estoque atual, estoque mínimo e duração estimada de consumo.
- Toda venda pertence a um cliente e possui pelo menos um item com quantidade maior que zero.
- A confirmação da venda reduz o estoque atomicamente.
- O estoque não pode ficar negativo.
- A previsão inicial é: data da venda + quantidade vendida × dias de consumo por unidade.
- Vendas com vários produtos geram previsões por item.
- O dashboard mostra recompra vencida, hoje e próximos sete dias.
- Produtos com estoque menor ou igual ao mínimo geram alerta.
- Datas são armazenadas de forma consistente e exibidas no fuso do negócio.

## Stack inicial

Next.js, TypeScript estrito, Tailwind CSS, Prisma, PostgreSQL, validação de entrada, testes unitários e de integração, Playwright efêmero e deploy em homologação na Vercel.

## Fora do escopo do MVP

Pagamentos, emissão fiscal, WhatsApp, mensagens automáticas, múltiplas empresas, permissões avançadas, relatórios financeiros completos, aplicativo nativo e IA preditiva.

## Contrato de sincronização

Antes de executar qualquer task, o agente deve confirmar que este SDD não contradiz o Google Docs. Divergência bloqueia o loop até reconciliação humana.
