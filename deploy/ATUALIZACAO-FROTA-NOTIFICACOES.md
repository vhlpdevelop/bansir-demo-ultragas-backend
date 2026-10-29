# Relatórios, clientes, entregadores e notificações

Esta atualização exige publicar o app e atualizar API e worker de notificações juntos. O ZIP do frontend não contém a migração nem o backend.

## Banco e serviços

1. Execute o backup antes da alteração.
2. Aplique `025_fleet_notifications.sql` pelo migrador normal (`npm run db:migrate`, com a conexão administrativa restrita ao processo de migração). Não altere migrações já aplicadas.
3. Recrie a imagem do backend e reinicie os serviços `api` e `notifications`. Os outros serviços que compartilham essa imagem podem ser recriados no mesmo deploy.
4. Confirme a saúde da API e ausência de falhas no worker. O worker exige as chaves VAPID já configuradas.

O scheduler é chamado pelo worker de notificações na inicialização e, depois, a cada 60 segundos. Analisa veículos ATIVO em empresas e estabelecimentos ativos. Usa exclusivamente a quilometragem registrada; não há telemetria automática.

Cada regra avisa quando restam até 10% do intervalo, limitado a 500 km, e novamente ao atingir/vencer a revisão. Admins e membros com permissão `fleet`, ativos na unidade, recebem sua própria notificação. Sem aparelho push habilitado, o aviso continua disponível na caixa do app. O envio revalida o acesso.

O histórico de jobs deduplica cada regra/revisão, etapa e destinatário; excluir o aviso não o recria na próxima varredura. Ao realizar uma revisão, atualize o KM da última manutenção. Atualizações dessa regra iniciam um novo ciclo de alertas. Nenhum job ou notificação é apagado automaticamente por esta migração.

A exclusão de notificações remove apenas o item do usuário no estabelecimento selecionado, protegida por RLS. Push ainda pendente é ignorado se o item já foi excluído; um push já entregue ao sistema operacional não é retirado remotamente.

## Frontend

O ZIP `migration-private/bansir-gas-relatorios-clientes-entregadores.zip` foi gerado com API `https://api-gas.bansir.com.br/api/v1`.

Extraia o ZIP e envie seu conteúdo à raiz do bucket do app `bansir-gas-app-prod-1`, preservando a configuração privada do bucket e o acesso via CloudFront. Invalide o cache da distribuição após o upload. Não envie código do backend, arquivos de ambiente ou a pasta `migration-private` ao bucket.

## Validação

- Build de produção e verificação de CSS aprovados.
- Integração PostgreSQL: frota/Meta/vales, notificações/worker e gestão/relatórios aprovados (29 testes).
- Teste adicional confirma que excluir a notificação antes da entrega suprime o push pendente.
- Conferência visual em navegador local com PostgreSQL descartável e dados fictícios, em desktop e celular.

Estas instruções documentam a publicação; a execução local dos testes não significa que a EC2 ou o S3 já receberam a atualização.
