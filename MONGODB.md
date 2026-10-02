# Conexão MongoDB Atlas

A conexão é lida de MONGODB_URI no .env do backend ou nas variáveis do ambiente.
O .env é ignorado pelo Git e não deve ser publicado. Variáveis definidas no Render
têm prioridade sobre arquivos locais. As variáveis VAPID são independentes.

O banco da aplicação é bansir_saas. Quando uma URI SRV não informa banco, o backend
adiciona esse nome e preserva as opções de conexão. Um banco informado explicitamente
na URI é respeitado.

Execute npm run db:check na pasta do backend para testar autenticação e ping.
O diagnóstico não cria coleções, índices ou registros e não imprime credenciais.
Depois, npm start inicia a API. A rota /api/health informa dbConnected.

No Render, configure MONGODB_URI com o valor do .env e reinicie o serviço.
Se o diagnóstico informar autenticação rejeitada, confira o usuário de banco em
Atlas > Database Access, o cluster correspondente e a senha. A conta do painel
Atlas não é a conta de acesso ao banco. Caracteres especiais na senha precisam
estar codificados para URI.

A configuração não copia exemplos em memória nem arquivos financeiros locais
para o Atlas. A migração de dados existentes é uma operação separada.


MongoDB agora é obrigatório em todos os módulos. Não há armazenamento alternativo em memória ou arquivos JSON. Configure a base inicial conforme [SEED.md](SEED.md). Execute `npm run seed:plan` para revisar e `npm run seed` para popular. A seed não é executada automaticamente pelo deploy.
