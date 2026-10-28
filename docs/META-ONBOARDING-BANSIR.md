# Aplicativo Meta central do Bansir

App ID informado: **1793938688602287**. O identificador é público; não é token, WABA ID ou Configuration ID. A empresa informou verificação empresarial concluída e cadastro como Provedor de Tecnologia independente. Ainda é necessário identificar o texto da etapa 2 exibida no painel; essas informações não comprovam aprovação das permissões ou liberação para conectar empresas externas.

O modelo acordado é um aplicativo Meta para vários estabelecimentos, com um número vinculado a cada unidade. A WABA pode conter mais de um número: o isolamento e o roteamento devem considerar **WABA ID + Phone Number ID**, vinculados a tenant, estabelecimento e destino autorizado.

## Dados para a integração

- `META_APP_ID`: 1793938688602287.
- `META_EMBEDDED_SIGNUP_CONFIG_ID`: obter da configuração do Embedded Signup no painel Meta. Não substituir pelo App ID.
- `META_GRAPH_VERSION`: versão habilitada no painel, sem presumir uma versão padrão.
- `META_APP_SECRET`: configurar exclusivamente no ambiente protegido do servidor responsável pelo OAuth/webhook; não colocar no app web, Git ou chat.
- `META_VERIFY_TOKEN`: segredo de verificação do webhook, distinto do App Secret e dos tokens dos estabelecimentos.

O App ID foi registrado no exemplo de ambiente; isso **não altera o ambiente da EC2 nem configura o painel Meta**. O fluxo de conexão automática ainda precisa ser implementado e validado. Atualmente o sistema permite cadastro administrativo de token por estabelecimento e não oferece Embedded Signup funcional.

## Próximas validações

1. Identificar a etapa atual pelo texto do painel. Conferir as permissões de mensagens/gestão do WhatsApp e o processo de análise exigido para este aplicativo.
2. Configurar o Embedded Signup e obter Configuration ID, domínios e versão da API. A empresa verificada não dispensa as demais aprovações do aplicativo.
3. Implementar autorização vinculada à sessão do administrador e ao estabelecimento, troca de código no servidor e validação dos ativos efetivamente concedidos antes de salvar qualquer vínculo. IDs enviados pelo navegador não constituem prova de propriedade.
4. Provisionar webhook central, filas SQS e registro DynamoDB, com IAM restrito. Não criar recursos pagos ou alterar o webhook real enquanto o template e os parâmetros não estiverem revisados.
5. Garantir unicidade global do número no registro central, cadastro autorizado de cada destino, deduplicação e encaminhamento somente dos eventos da unidade. Tokens de envio e dados comerciais continuam isolados por estabelecimento.
6. Validar conexão, recebimento e envio com ativos de teste e pelo menos dois estabelecimentos antes de liberar a conexão de clientes.

Referência: [Embedded Signup da Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider).
