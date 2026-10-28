# Publicar o webhook Meta do Bansir

Pacote independente da API. Não instala NFeWizard nem MongoDB no Lambda. **Preparado para publicação; nenhum recurso AWS foi criado por este pacote.** O Embedded Signup e a conexão automática de clientes ainda não fazem parte desta entrega. O primeiro vínculo é cadastrado por um administrador após conferir os ativos autorizados.

## 1. O que você precisa

- Conta AWS, região **sa-east-1 / São Paulo**, acesso para CloudFormation, SAM, IAM, Lambda, API Gateway HTTP, SQS, DynamoDB, Secrets Manager e CloudWatch.
- AWS CLI autenticada e AWS SAM CLI instaladas. Execute `aws sts get-caller-identity`, `sam --version` e `node --version` antes de começar. [Instalar SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html).
- Node 22 ou superior para instalar/testar o pacote. Se usar AWS CloudShell, envie e extraia o ZIP e confira as ferramentas acima; instale as ausentes conforme a documentação.
- App ID **1793938688602287**, App Secret do mesmo aplicativo e um verify token aleatório. **Não envie segredos no chat ou coloque-os no Git.**
- Para receber eventos reais: WABA ID, Phone Number ID, UUID da empresa e UUID do estabelecimento; número autorizado, conta Meta configurada e permissões correspondentes. Nunca cadastrar o número de um cliente em outra empresa.

O endpoint inicial usará HTTPS do API Gateway. Não precisa configurar Route 53, ACM ou domínio próprio agora. O código não exige VPC, NAT Gateway ou banco em EC2 para rotear.

## 2. Criar o segredo na AWS

Console AWS → Secrets Manager → Armazenar novo segredo → Outro tipo de segredo → Texto simples. Usar este formato, substituindo os valores:

```json
{"appSecret":"SEGREDO_REAL_DO_APP_META","verifyToken":"TOKEN_ALEATORIO_LONGO"}
```

Nome sugerido: `bansir/meta/webhook`. Para o verify token, gerar localmente `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Guarde-o no seu cofre: ele será informado no painel Meta. Use a chave padrão do Secrets Manager nesta primeira instalação, sem rotação automática. Copie o **ARN** do segredo, não seu conteúdo. O template concede leitura somente à Lambda de entrada. O segredo é cacheado por até 60 segundos.

Secrets Manager, API Gateway, logs e os dois alarmes têm cobrança própria; a solução não promete gratuidade. Configure alerta de orçamento, por exemplo US$ 5/mês. Alertas não bloqueiam gastos. O template não configura envio de e-mail dos alarmes: para receber avisos, associe uma ação SNS confirmada no console.

## 3. Publicar a infraestrutura

No diretório deste README:

```sh
npm ci --ignore-scripts
npm test
sam validate --lint --region sa-east-1
sam build
sam deploy --guided --region sa-east-1
```

No assistente:

| Campo | Valor |
|---|---|
| Stack Name | `bansir-meta-prod` |
| Region | `sa-east-1` |
| MetaAppId | `1793938688602287` |
| MetaSecretArn | ARN do segredo criado acima |
| CellId | `gas-1` |
| Confirm changes before deploy | `Y` |
| Allow SAM CLI IAM role creation | `Y` |
| Function without authorization | `Y`: o webhook precisa ser público; POST valida assinatura Meta |
| Save arguments to configuration file | `Y`, arquivo local ignorado pelo Git |

Revise o changeset e publique. Não informe App Secret como parâmetro do SAM. Nenhuma função faz logs de tokens ou conteúdo de mensagens. A rota GET usa verify token; a POST usa HMAC SHA-256 sobre os bytes originais. Corpo acima de 200 KB é rejeitado, sem truncamento. Eventos não suportados não viram pedidos automaticamente.

Anote os Outputs: `WebhookUrl`, `RoutesTable`, `CellQueueUrl`, `CellQueueArn`, `CellConsumerPolicyArn`, `IngressDeadQueueUrl` e `CellDeadQueueUrl`.

## 4. DynamoDB: configuração exata

**O template cria a tabela automaticamente. Não criar outra tabela manualmente.**

- Classe Standard; capacidade **sob demanda / PAY_PER_REQUEST**.
- Chave de partição `pk` (String), sem sort key, índices secundários, Streams ou TTL.
- Criptografia em repouso habilitada; proteção contra exclusão habilitada. A tabela é preservada se a stack for excluída.
- Sem réplica global, capacidade provisionada ou backups contínuos nesta configuração inicial. A tabela é um catálogo reconstruível; faça exportação/backup antes de alterar vínculos de produção.
- As Lambdas só recebem `GetItem`; cadastro/alteração de vínculos exige credencial administrativa separada. Nenhum navegador ou usuário de estabelecimento escreve diretamente na tabela.

Dois tipos de registro:

```json
{"pk":"CELL#gas-1","queueUrl":"https://sqs.sa-east-1.amazonaws.com/CONTA_AWS/bansir-meta-cell-gas-1","enabled":true}
```

```json
{"pk":"APP#1793938688602287#PHONE#ID_NUMERO_META","wabaId":"ID_WABA","tenantId":"UUID_EMPRESA","establishmentId":"UUID_ESTABELECIMENTO","cellId":"gas-1","enabled":true}
```

O primeiro é uma EC2/célula; o segundo é um estabelecimento/número. Vários números podem pertencer à mesma WABA. A chave do número é global para este aplicativo, impedindo cadastrar o mesmo número em duas unidades pelo script.

Crie um `route.json` local com:

```json
{"accountId":"ID_AWS_12_DIGITOS","cellId":"gas-1","phoneNumberId":"ID_NUMERO_META","wabaId":"ID_WABA","tenantId":"UUID_EMPRESA","establishmentId":"UUID_ESTABELECIMENTO"}
```

Os UUIDs vêm do PostgreSQL da unidade, não do CNPJ nem da Meta. Um administrador pode consultar `SELECT tenant_id,id,name FROM bansir.establishments;` no banco correto. WABA/Phone Number ID vêm do painel Meta. Confira que a conta Meta local salva no SaaS pertence exatamente a esses ativos.

Linux/CloudShell:

```sh
export AWS_REGION=sa-east-1
export ROUTES_TABLE=NOME_DO_OUTPUT_RoutesTable
node src/register-route.js route.json
```

O script usa transação e condições para não sobrescrever um número de outra empresa/estabelecimento/célula. Exige IAM `dynamodb:PutItem` na tabela, incluindo as gravações transacionais. Não executa envio WhatsApp nem comprova propriedade na Meta: o administrador deve conferir a autorização antes. Para migrar uma unidade entre EC2, interromper o roteamento, drenar/conferir as filas e atualizar o vínculo de forma controlada; não alterar só o IP.

## 5. Consumidor na EC2

Antes de assinar mensagens reais, instalar o consumidor. Ele valida aplicativo, célula, empresa, estabelecimento, WABA e número contra o cadastro local. Eventos repetidos são deduplicados pelo PostgreSQL.

1. Anexar a policy do Output `CellConsumerPolicyArn` à IAM role da EC2. Cada EC2 recebe acesso **somente à própria fila**, sem chaves AWS estáticas. IMDSv2 deve estar habilitado; o container abaixo usa rede host.
2. Aplicar a migração PostgreSQL **020_meta_cell_ingest.sql** com o migrador administrativo e backup prévio. Ela adiciona a função restrita de conferência do vínculo e a concessão para ingestão. A credencial administrativa não entra no consumidor.
3. Criar um login restrito dedicado, sem propriedade de tabelas, SUPERUSER ou BYPASSRLS, membro de `bansir_worker`. Definir a senha por canal protegido. API e worker de saída continuam separados.
4. Copiar `cell.env.example` para `/etc/bansir/meta-cell.env`, preencher URL da fila, célula e URL do login restrito. Usar `chmod 600`. Esse arquivo não contém App Secret nem chave fiscal. `META_APP_ID` é o mesmo do aplicativo central.
5. Dentro de `deploy/meta-gateway`, construir/iniciar:

```sh
sudo docker build -t bansir-meta-cell:1 .
sudo docker run -d --name bansir-meta-cell --restart unless-stopped --network host --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m --cap-drop ALL --security-opt no-new-privileges --env-file /etc/bansir/meta-cell.env bansir-meta-cell:1
sudo docker logs --tail 30 bansir-meta-cell
```

Alternativa: `cell.service.example`, caso Node esteja instalado no host. Ajustar o caminho do executável após `command -v node`, instalar as dependências, copiar o serviço e ativar com systemd. Não executar Docker e systemd ao mesmo tempo para a mesma instância de consumidor.

O consumidor não expõe porta, renova visibilidade durante o processamento e só exclui a mensagem da fila depois do commit. Falhas retornam à fila; após oito recebimentos vão à DLQ. Mensagens são retidas por até 14 dias, não indefinidamente. Monitore a idade da fila e as DLQs; não fazer redrive automático sem corrigir a causa.

## 6. Configurar a Meta

No aplicativo **1793938688602287**, no campo de callback Webhooks, informar o Output `WebhookUrl` e exatamente o `verifyToken` do segredo. Verificar e salvar. Assinar o campo `messages` e inscrever o aplicativo na WABA correspondente. Não usar o IP da EC2 como callback.

Teste primeiro a verificação GET e a ferramenta de teste do painel; depois receba uma mensagem real de um número de teste autorizado. Confirme: resposta HTTP 200, fila processada, nenhuma DLQ e mensagem visível somente no estabelecimento correto. Um 200 confirma armazenamento na fila, não processamento comercial. Testar com dois estabelecimentos é obrigatório antes de liberar onboarding externo.

Não trocar o webhook de produção antes de instalar migração, consumidor e rotas. Se a assinatura estiver incorreta, retorna 403; se não puder salvar na fila, 503 para permitir retry da Meta. Rota desconhecida/WABA divergente é reenviada até DLQ, sem envio para uma unidade padrão. A Meta pode entregar eventos repetidos ou fora de ordem.

## 7. Adicionar outra EC2

Criar uma fila Standard `bansir-meta-cell-CELULA`, com SSE-SQS, retenção 14 dias, long polling 20 segundos, visibilidade 120 segundos e DLQ com maxReceiveCount 8. Criar policy Receive/Delete/GetQueueAttributes restrita ao ARN dessa fila e anexar só à role da nova EC2. Instalar o mesmo consumidor com novo `META_CELL_ID`. Registrar os novos números usando o script e a nova célula. O roteador já permite as filas com prefixo `bansir-meta-cell-` da mesma região/conta, sem alterar código ou o aplicativo Meta.

## Validação e limites

`npm test` usa transporte simulado e cobre assinatura, corpo base64, durabilidade, separação de payloads e falhas parciais. Foi acrescentada cobertura do vínculo local da migração 020 em `test/meta-vouchers-fleet.integration.test.js`, mas sua execução nesta entrega ficou bloqueada pelo Docker local desligado. Executar esse teste antes de ativar o consumidor. Fazer `sam validate --lint` e um deploy de teste na conta AWS antes de cadastrar o callback real. O template passou no cfn-lint com transformação SAM, sem alertas. SAM/AWS CLI não estavam disponíveis no ambiente de preparação; o deploy remoto não foi executado.

Envio de mensagens continua no worker Meta já existente, com token criptografado por estabelecimento, templates e consentimento. Este pacote implementa **entrada e roteamento**; não implementa Embedded Signup, pedidos automáticos, cobrança Meta ou habilitação de permissões do aplicativo. A administração de rotas é manual até a conexão automática validar os ativos no servidor.

A tabela e as quatro filas são preservadas na exclusão da stack. Para recriar com o mesmo CellId, conferir os recursos retidos; não apagar filas com mensagens pendentes. A solução ainda exige teste real em AWS/Meta e validação do consumidor conectado ao PostgreSQL.
