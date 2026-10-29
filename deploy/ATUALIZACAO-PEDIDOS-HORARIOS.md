# Pedidos, conversas e expediente

## Publicação

Esta alteração está preparada localmente. Faça backup e aplique as migrações pendentes pelo migrador normal, incluindo `025_fleet_notifications.sql` da atualização anterior e `026_business_hours.sql`. Recrie a imagem e reinicie a API e os workers de notificações e WhatsApp. A migração 026 não altera horários existentes nem habilita uma agenda automaticamente.

Publique o conteúdo extraído de `migration-private/bansir-gas-pedidos-horarios.zip` na raiz do bucket do app, preservando o acesso privado via CloudFront, e invalide o cache. Esse ZIP inclui também as melhorias anteriores de relatórios, clientes e entregadores. Não publique a pasta migration-private nem arquivos do backend.

## Configuração

O dono configura o expediente em **Página de pedidos → Dias e horários de atendimento**: dias abertos, abertura, fechamento, fuso horário e antecedência do aviso (padrão de 30 minutos). Cada dia aceita um intervalo; fechamento anterior à abertura significa encerramento no dia seguinte. A agenda é opcional para preservar o comportamento de lojas ainda não configuradas.

Ao habilitar a agenda, novos pedidos públicos são bloqueados fora do expediente tanto no frontend como na API; pedidos anteriores continuam consultáveis e gerenciáveis. A opção manual de pausar pedidos prevalece sobre a agenda. A página pública mostra o estado e permite consultar os horários semanais.

A opção de ignorar WhatsApp fora do expediente se aplica à saudação automática. Mensagens continuam registradas e exibidas no histórico; não são respondidas depois apenas por a loja reabrir. A decisão usa o horário de recebimento e é conferida novamente antes do envio. Mensagens manuais e avisos transacionais de pedidos/vales mantêm seu comportamento existente. Nada é enviado à Meta durante os testes locais.

## Conversas

**Pedidos do link → Conversas e janela Meta** reúne contatos de pedidos e mensagens em cartões, com nome do cadastro quando disponível, telefone, última atividade, quantidade de pedidos, últimas 20 mensagens e tempo restante da janela de 24 horas a partir da última mensagem recebida. Um pedido no link não abre essa janela. A busca é interna, com autorização de vendas e RLS do estabelecimento; nenhum nome ou histórico é adicionado à consulta pública por telefone.

O feed é paginado em 30 contatos e atualizado a cada 15 segundos. As regras de templates e consentimento do worker continuam ativas.

## Validação

Build de produção e CSS aprovados. Testes aprovados: calendário (1), integração storefront (9) e integração Meta/vales/frota (14), incluindo isolamento de unidades, bloqueio do checkout, preservação da mensagem fora do horário e ausência de envio automático. Conferência visual local em desktop e celular com dados fictícios.
