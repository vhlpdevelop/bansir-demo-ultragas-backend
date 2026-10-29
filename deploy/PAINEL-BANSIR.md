# Central administrativa Bansir

Acesso no frontend existente em `/bansir-admin`. Identidades e sessões separadas dos usuários de estabelecimentos. A conta de um cliente, mesmo com papel `superadmin`, não dá acesso à central.

## Implantação

1. Preservar alterações locais e publicar os arquivos de backend e frontend pelo fluxo habitual.
2. Executar `npm run db:migrate` usando `DATABASE_ADMIN_URL` no processo de migração. A migração 029 segue o modelo de funções SECURITY DEFINER das migrações existentes; executar com o mesmo proprietário administrativo das funções atuais, capaz de acessar as tabelas com RLS forçado. Não usar credenciais administrativas no processo da API.
3. No processo administrativo, definir `PLATFORM_ADMIN_EMAIL` (padrão `contato@bansir.com.br`) e executar `node scripts/provision-platform-admin.js` uma única vez. Não sobrescreve conta existente.
4. A senha aleatória é gravada em `migration-private/painel-bansir-primeiro-acesso.txt`, ignorado pelo Git. Entregar ao responsável por canal privado e remover o arquivo depois da troca. Não imprimir credenciais em logs nem incluir esse arquivo em ZIPs de publicação.
5. Reiniciar a API pelo fluxo habitual e publicar o build do frontend. O hosting deve redirecionar `/bansir-admin` para `index.html`, como já faz nas rotas da aplicação. Quando frontend e API tiverem origens diferentes, preservar `VITE_API_URL` e a lista explícita de CORS.
6. Abrir `/bansir-admin`, entrar e alterar a senha temporária. A troca encerra todas as sessões administrativas; entrar novamente com a nova senha.

Alternativa sem conexão local: `node scripts/provision-platform-admin.js --prepare` gera o arquivo privado de primeiro acesso e `migration-private/painel-bansir-criar-admin.sql`, com hash bcrypt. Nesse modo a conta só existe após aplicar esse SQL com a conexão administrativa depois da migração 029. Não executar também o provisionamento direto para a mesma conta. Esses dois arquivos são privados e não fazem parte do pacote de publicação.

## Escopo desta etapa

- Lista empresas já provisionadas, plano e unidades ativas. Usa os planos existentes; criação de empresas/unidades continua no provisionamento atual, e criação de novos planos continua pelo processo administrativo existente.
- Altera plano respeitando limite de unidades, mensalidade contratada, próxima data, observações e situação da empresa. Suspensão encerra sessões operacionais e bloqueia login/acesso dos usuários pelos controles existentes. Não remove dados. Não representa desligamento dos workers ou integrações externas.
- Registra liberações **contratadas por tenant** para WhatsApp, link de pedido e inteligência financeira. Não muda ainda o funcionamento dos módulos ou workers. A aplicação por estabelecimento é a próxima etapa; registros não significam habilitação técnica, conexão Meta ou liberação fiscal.
- Registra cobranças manuais com referência única por empresa, valor e vencimento. Confirma recebimento manual, apenas uma vez, com auditoria. Não cobra cartão/PIX, não envia mensagens, não emite documento fiscal e não gera recorrências automáticas. A próxima data do contrato é uma previsão informada e não muda automaticamente quando uma cobrança é paga.
- Guarda últimas 50 atividades para consulta; os demais registros continuam no banco.
- Sessão administrativa opaca de duas horas, hash no banco, armazenamento por aba no navegador, logout revogável e troca de senha obrigatória. Senhas com 12 a 72 bytes, bcrypt custo 12 e limitação de tentativas.

## Validação

`npm run test:postgres -- test/platform-admin.integration.test.js test/password.integration.test.js` cria um PostgreSQL descartável no Docker, aplica migrações e valida isolamento, troca de senha, revogação, contratos, datas e pagamento duplicado. Nunca apontar esses testes para produção.

No frontend: `npm run build` e `npm run lint`.

Para o pacote de produção AWS, sobrescrever `VITE_API_URL` no processo de build com `https://api-gas.bansir.com.br/api/v1`. Os arquivos `.env.production` existentes ainda apontam para o Render; não publicar um build padrão sem conferir essa variável. O pacote `migration-private/bansir-gas-painel-admin-frontend.zip` contém o build completo para AWS, com `index.html` na raiz. O pacote `bansir-gas-painel-admin-backend.zip` contém somente os arquivos alterados nesta etapa, preservando caminhos; não contém credenciais. Aplicar o backend e a migração antes de disponibilizar o novo frontend.

Validação desta entrega: testes PostgreSQL do painel e da troca de senha operacional passaram em container descartável; build passou; arquivos novos de frontend passaram no lint. Lint geral permanece bloqueado por hooks condicionais preexistentes em `CheckoutInvoiceModal.jsx`. Layout conferido em desktop e celular usando dados fictícios (não são cadastros/valores reais).
