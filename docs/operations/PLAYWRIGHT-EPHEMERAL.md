# Política de Playwright Efêmero

Para tasks de interface:

1. gerar cenário temporário em `.rick/tmp/playwright/<run-id>/`;
2. validar apenas o comportamento criado e um smoke curto dos fluxos relacionados;
3. em falha, manter trace e screenshot somente durante a correção;
4. após PASS, remover teste, trace, screenshots e relatório temporário;
5. persistir em `docs/evidence/` apenas resumo dos cenários, duração e resultado;
6. considerar qualquer retry necessário como FLAKY e bloquear o próximo loop.

Ao final do roadmap, executar um fluxo E2E mais amplo comprovando o objetivo do MVP.
