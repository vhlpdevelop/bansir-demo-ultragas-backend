# Ativar o botão Conectar WhatsApp

Esta atualização acrescenta uma Lambda privada de conexão, sem mudar o URL do webhook. A Lambda é específica da célula `gas-1`; apenas a role dessa EC2 poderá invocá-la. Ela troca o código, confere o aplicativo e as permissões, valida WABA/número e reserva o vínculo global. O token volta somente à API autenticada e é salvo criptografado por estabelecimento. A rota fica desativada até o commit local e uma segunda chamada de ativação.

## No console AWS, sem editar código

1. No bucket `bansir-meta-artifacts-783764583281-sa-east-1`, enviar o ZIP **bansir-meta-gateway-embedded-v1.zip inteiro**, sem extrair. Manter o bucket privado.
2. CloudFormation, São Paulo → stack **bansir-meta-prod** → Atualizar → Substituir modelo → carregar **infraestrutura-meta-embedded.yaml**.
3. Preservar o segredo, CellId, App ID e bucket. No parâmetro **ArtifactKey**, informar `bansir-meta-gateway-embedded-v1.zip`. Não reutilizar o nome do ZIP antigo: uma nova chave garante que o código das funções seja atualizado.
4. Revisar o changeset, reconhecer as capacidades IAM/transformação apresentadas e concluir. Aguardar **UPDATE_COMPLETE**. A nova Lambda tem nome `bansir-meta-prod-connect-gas-1` e usa a versão Graph `v25.0`.
5. Copiar os novos Outputs **ConnectFunctionArn** e **ConnectPolicyArn**.
6. IAM → função **bansir-gas-1-role** → adicionar a policy do Output **ConnectPolicyArn**, preservando a policy da fila. Essa policy concede somente `lambda:InvokeFunction` na função desta célula, sem acesso ao segredo nem gravação direta no DynamoDB.
7. Se a API Docker não conseguir obter a role, EC2 → instância → configurações de metadados: manter IMDSv2 obrigatório e definir limite de saltos como **2**. Não criar access keys permanentes nem copiar credenciais temporárias da role para arquivos.

## No painel Meta

Na configuração **1017617441354422** do aplicativo **1793938688602287**, permitir o domínio `gas.bansir.com.br` no login com JavaScript e os endereços HTTPS exatos do fluxo conforme o painel exigir. A URL do webhook Lambda não é uma URL de retorno OAuth do SaaS. Manter a configuração de coexistência fornecida pelo painel; nenhuma conta deve ser removida do aplicativo do celular para testar esse fluxo.

O aplicativo precisa ter as permissões de gestão e mensagens efetivamente concedidas para os ativos utilizados. A empresa verificada não substitui a análise de permissões para clientes externos. Revogar o token anteriormente compartilhado no chat. O novo fluxo não utiliza esse token: cada cliente autoriza um código novo, trocado no servidor.

## Na EC2 e no app

Aplicar a migração **021_meta_embedded_signup.sql**, preservando as anteriores. A API precisa de `AWS_REGION=sa-east-1`, `META_APP_ID=1793938688602287`, `META_EMBEDDED_SIGNUP_CONFIG_ID=1017617441354422`, `META_GRAPH_VERSION=v25.0` e `META_CONNECT_FUNCTION_ARN` igual ao Output. Depois de confirmar o InvokeFunction pela role e a configuração Meta, ativar `META_EMBEDDED_SIGNUP_ENABLED=true`. Até lá, o botão permanece desabilitado. O App Secret permanece somente no Secrets Manager central. Preservar `FISCAL_ENCRYPTION_KEY`, necessária para cifrar os tokens por estabelecimento.

Publicar o ZIP do app no bucket do site e invalidar `/*` no CloudFront. Em **Configurações → WhatsApp**, o administrador clica em **Conectar WhatsApp pela Meta**, autoriza a conta e o número do estabelecimento e aguarda a ativação. Não inserir IDs/tokens manualmente para esse fluxo. Se ocorrer falha após salvar a conta, usar **Concluir ativação pendente**; não precisa repetir o login Meta. As tentativas expiram em dez minutos e pertencem à sessão e unidade que as criou.

Começar pela unidade **BANSIR - HOMOLOGACAO META**, sem vincular o número de teste à Jaslei. Testar entrada real, confirmação de status, isolamento entre duas unidades e desconexão. O botão não envia uma mensagem nem cria pedidos automaticamente. Templates, consentimento, pagamento e worker de saída continuam com suas configurações próprias.

## Operação

Desconectar desativa primeiro a rota central e depois remove a conta local. Não remove a inscrição da WABA inteira, pois ela pode conter outros números. Trocar de número exige desconectar primeiro. Ajustes manuais de templates/idioma preservam o token; alterar IDs/token de uma conexão incorporada exige refazer a autorização.

Para outra EC2, criar uma função Connect dedicada com seu CellId/QueueUrl fixos e conceder InvokeFunction somente à role correspondente; nunca permitir que um chamador escolha outra célula no corpo da requisição. O endereço central do webhook e o aplicativo Meta permanecem os mesmos.
