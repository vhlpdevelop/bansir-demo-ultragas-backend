# Falha de abertura do Bansir Gás — 29/10/2026

## Causa comprovada

O index.html em produção referencia /assets/index-mgPcPhNN.js e /assets/index-fTPPcdtp.css. Ambos retornam HTTP 403. Os mesmos arquivos na raiz (/index-mgPcPhNN.js e /index-fTPPcdtp.css) retornam 200 com Content-Type correto. A pasta assets foi achatada no upload ao S3.

A API da EC2 respondeu saudável, PostgreSQL conectado. Sem evidência de falha da API como causa da tela em branco. Não foi necessário alterar código, migração ou banco para esse diagnóstico.

Teste isolado no navegador: redirecionar apenas as requisições /assets/ para os arquivos existentes na raiz restaurou a tela de login, sem erros JavaScript. Esse redirecionamento é exclusivamente diagnóstico e não altera produção. Não é a correção permanente.

O pacote completo existente contém os caminhos corretos, e o JavaScript aponta para a API AWS. Foi preparado bansir-gas-reparo-assets.zip, contendo apenas os 11 assets originais, preservados byte a byte.

## Correção pelo console AWS

1. Extrair migration-private/bansir-gas-reparo-assets.zip. Ele contém uma pasta assets.
2. Abrir o bucket bansir-gas-app-prod-1 no S3 (não o institucional nem o fiscal).
3. Na raiz do bucket, escolher Carregar -> Adicionar pasta e selecionar a pasta assets extraída. Não selecionar apenas os arquivos internos na raiz do bucket.
4. Conferir que o destino será assets/index-mgPcPhNN.js e assets/index-fTPPcdtp.css, junto dos demais chunks. Alternativamente criar/abrir a pasta assets no S3 e carregar todos os arquivos dentro dela.
5. Manter o bucket privado e as permissões CloudFront/OAC existentes. Não habilitar acesso público.
6. Invalidar /assets/* na distribuição CloudFront associada a gas.bansir.com.br, para remover os 403 em cache.
7. Reabrir o sistema (Ctrl+F5) e conferir também /bansir-admin. Se abrir a tela de login, os recursos estáticos foram restaurados; isso não substitui teste funcional do painel autenticado.

Não excluir os arquivos antigos durante esse reparo. Não precisa reenviar index.html nem mexer no banco. Arquivos de versões anteriores podem ser necessários a abas já abertas.

## Limitação de acesso

A role bansir-gas-1-role da EC2 não possui s3:ListBucket para bansir-gas-app-prod-1. A publicação remota não foi executada. Usar o console do proprietário ou um perfil de deploy autorizado; não ampliar a role de execução da API só para esse reparo.
