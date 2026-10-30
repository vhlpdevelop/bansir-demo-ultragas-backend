# Retirada do legado MongoDB — 30/10/2026

Antes da retirada, foram conferidos os processos em execução na EC2:

- API `src/server.js`, DATABASE_ENGINE=postgres, DATABASE_URL presente e MONGODB_URI ausente.
- Notificações e fiscal: `scripts/worker-postgres.js`.
- WhatsApp: `src/postgres/whatsapp.worker.js`.
- Serviço Meta separado: sem configuração MONGODB_URI; não foi alterado.

Não foi encontrada função de negócio que utilizasse MongoDB nesses processos. Os imports estáticos do inicializador antigo carregavam Mongoose e modelos do bridge legado antes da seleção de banco, mas o caminho MongoDB não era executado na API PostgreSQL.

A análise das dependências transitivas dos três pontos de entrada PostgreSQL, incluindo imports dinâmicos literais e subprocessos referenciados por URL, identificou 61 arquivos sem referência a pacotes MongoDB. A única função compartilhada sob src/modules era calculatePricing, pura, agora em src/shared/pricing-calculator.js. O teste de paridade com o frontend foi preservado.

Foram retirados os módulos, modelos, rotas, serviços, inicializador Express, scripts de seed/exportação/diagnóstico e testes exclusivos do legado MongoDB, além de Mongoose e mongodb-memory-server. Antes da exclusão, verificou-se que nenhum import dos arquivos mantidos em src/, scripts/ ou test/ apontava para o conjunto retirado. A relação de arquivos é recuperável pelo diff e pelo histórico Git.

O inicializador passa a aceitar somente PostgreSQL e rejeita explicitamente DATABASE_ENGINE=mongodb. Nenhum dado foi convertido ou apagado; certificados, snapshots privados, backups, migrações SQL, filas, funções PostgreSQL, permissões e credenciais foram preservados. O importador de snapshots já exportados para PostgreSQL continua disponível. A ferramenta de exportar novos snapshots diretamente do MongoDB foi aposentada; se necessária, pode ser recuperada do histórico anterior, em ambiente isolado.

Validação: testes unitários com Mongoose ausente do node_modules e suítes PostgreSQL em bancos Docker descartáveis. A expectativa antiga de um teste-base sobre GET /settings foi atualizada: quem opera PDV pode ler os dados básicos da sua unidade, mas continua sem poder alterá-los ou ler a configuração da outra unidade. Testes de RBAC e configurações granulares permanecem.

`npm test` agora executa explicitamente apenas os testes unitários em test/, evitando a descoberta automática de scripts operacionais e helpers privados. `npm run test:postgres` executa as integrações em banco descartável.

Não há alteração de frontend ou necessidade de novo upload no S3 nesta etapa. A imagem Docker e a API precisam ser atualizadas para aplicar a retirada em produção. Não apagar imagens de rollback nem volumes do banco para liberar espaço de build.
