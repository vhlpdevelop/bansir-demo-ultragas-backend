# Conector Windows e API PostgreSQL

O protocolo 1 do repositório bansir-bridge é compatível com a API PostgreSQL. Não há cobrança, cancelamento de cartão nem impressão remota no protocolo atual; terminais sem adaptador retornam not_supported. Imprimir continua pelo QZ. Nenhum estado de diagnóstico registra pagamento.

## Servidor

Aplicar migração 028_bridge.sql, publicar backend e reiniciar API. Configurar BRIDGE_PUBLIC_URL=https://api-gas.bansir.com.br/api/v1. O Nginx precisa encaminhar Upgrade e Connection para /api/v1/bridge/ws com HTTP/1.1 e timeout compatível com heartbeat de 20 segundos. Nenhuma porta pública adicional é necessária.

Tokens são gerados por admins da unidade selecionada, duram um ano e são exibidos uma vez no formato bpdv1_. PostgreSQL guarda somente o hash da credencial. A primeira identificação vincula o token a installationId; outra instalação exige outro token. Revogação pela API encerra o socket; validade, vínculo e acesso do emissor são revalidados no heartbeat. As listas e configurações usam RLS e contexto tenant/estabelecimento. Ping só aceita resposta da conexão solicitada. Não há tenant default.

O registro de conexões é mantido em memória para esta API de uma instância. Reinício exige reconexão automática do cliente. Múltiplas réplicas exigem roteamento/distribuição de estado antes de escalar; não presumir que uma conexão está disponível em todos os processos.

## Caixa Windows

1. Publicar o ZIP do app bansir-gas-bridge-aws.zip no S3 e invalidar o CloudFront.
2. Em Configurações → Equipamentos, gerar código próprio para o computador e copiar no instalador Bansir PDV. Códigos do Render não são reutilizados nem migrados automaticamente.
3. Permitir a origem https://gas.bansir.com.br no appsettings.json do serviço. O repositório do conector já traz essa origem; instalações anteriores podem executar scripts/configure-ultragas.ps1 como administrador depois de substituir o código pelo instalador.
4. Conferir computadores conectados e usar Testar conexão. O estado online da API é independente da permissão do navegador para consultar localhost.
5. Instalações existentes podem usar seu executável 0.3.0, pois o formato e os eventos foram preservados. Não foi gerado novo instalador nesta atualização; publicar um novo EXE exige .NET SDK 8 e scripts/publish.ps1 no repositório do conector.

Não compartilhar código de conexão ou gravá-lo no repositório. Cada computador precisa de código próprio; não copiar installation-id de outro computador.

## Validação

Teste com WebSocket real e PostgreSQL descartável cobre geração/listagem segura, isolamento de unidades, configuração de terminais, ping, vínculo de instalação e revogação/rejeição de reconexão. Regressão do PDV verifica que não houve alteração de cobrança.
