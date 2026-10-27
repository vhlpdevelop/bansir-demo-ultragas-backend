# Meta, Vale Gás e frota

Aplicar a migração **018** depois das anteriores, com backup e credencial administrativa fora da API. Não editar migrações antigas. O app PostgreSQL passa a exibir Vale Gás e Frota conforme o RBAC do estabelecimento selecionado.

## Vale pago na emissão

Abrir o caixa em Vendas/PDV. Na emissão do vale, confirmar dinheiro recebido, PIX conferido ou cartão aprovado na maquininha externa. A emissão grava, na mesma transação, venda paga, pagamento, movimentação do caixa, reserva de estoque disponível e vale vinculado à venda. O UUID da tentativa é persistido no navegador antes do envio; repetir ou recuperar a operação retorna o mesmo vale. Reutilizar o UUID com outro conteúdo retorna conflito.

A reserva reduz o estoque disponível imediatamente, com motivo `Reserva vale <venda>`. Resgatar confirma a entrega e registra quem a realizou; não cobra nem baixa o estoque outra vez. O cancelamento da venda usa o fluxo de estorno do PDV, devolve estoque uma vez e cancela o vale. Vales antigos sem venda/pagamento vinculado exigem conciliação; a API bloqueia seu resgate e não inventa pagamentos históricos.

Somente administradores e perfis com `valegas`/`valegas-issue` emitem; entregadores e perfis `valegas-redeem` podem resgatar. Para emitir, o operador também precisa conseguir abrir seu caixa pelo módulo Vendas. Frota exige administrador. RLS e chaves compostas mantêm as unidades isoladas; a migração concede a permissão SQL que faltava para excluir veículos.

## Configurar a Meta

1. Criar/configurar o aplicativo empresarial no painel Meta, habilitar WhatsApp e cadastrar/verificar WABA e número. Obter token com as permissões adequadas ao envio e manter a política de renovação/revogação da conta. Este MVP usa cadastro administrativo por estabelecimento; Embedded Signup ainda não está implementado.
2. Na API, definir `META_APP_SECRET` com o segredo real do aplicativo e `META_VERIFY_TOKEN` com um segredo aleatório de verificação. Reiniciar a API. Não confundir esses valores com o token de acesso de cada estabelecimento.
3. Cadastrar o webhook `https://api-gas.bansir.com.br/api/v1/whatsapp/webhook`, informar o mesmo verify token e assinar eventos `messages` da WABA. O endpoint valida HMAC SHA-256 sobre o corpo original antes de processar dados e só os associa ao número e WABA cadastrados. Eventos repetidos são deduplicados no PostgreSQL.
4. Em **Configurações → WhatsApp**, salvar ID do número, ID WABA e token. O token fica criptografado com AES-GCM, vinculado à empresa/unidade, e não volta nas respostas. A chave `FISCAL_ENCRYPTION_KEY` deve ser a mesma da API e do worker Meta, preservando o backup existente.
5. Aprovar templates de texto para vale e entrega na Meta e cadastrar seus nomes/idioma no app. O formato implementado exige **um parâmetro de texto no corpo**, com os detalhes do aviso. Registrar consentimento do destinatário apenas quando obtido. Fora da janela de 24 horas após mensagem recebida, o worker exige consentimento e template; dentro dela pode usar texto de atendimento. O cadastro de um cliente ou uma venda não concede consentimento automaticamente.
6. Criar `deploy/whatsapp.env` a partir do exemplo, com login restrito `bansir_worker`, chave de criptografia e `META_GRAPH_VERSION` exatamente como a versão habilitada no aplicativo Meta. Nenhuma versão padrão é presumida. Usar `docker compose --profile meta -f compose.production.yml up -d whatsapp`, incluindo o override da EC2 se aplicável.

O profile Meta fica desativado até a configuração real. `CONFIGURED` indica apenas credenciais cadastradas; não comprova conexão ou entrega. A tela mostra fila, erros e confirmações recebidas. O worker revalida o autor e a conta antes do envio, respeita lease e usa retry limitado em rate limit. Timeout, resposta ambígua ou queda após submissão exigem revisão (`META_SEND_UNCERTAIN`), evitando reenvio automático que possa duplicar avisos. `done` significa aceito pelo provedor; entrega/leitura vêm por webhook. Receber mensagem não cria pedidos ou vendas automaticamente.

Baileys e sua dependência foram removidos; não iniciar o worker antigo nem usar sessões/QR legados. Dados históricos não são excluídos. O botão de compartilhar vale manualmente abre o WhatsApp do operador e não representa envio pela API.

## Verificação

`node scripts/test-postgres.js test/meta-vouchers-fleet.integration.test.js` cobre emissão concorrente, caixa/estoque únicos, resgate sem cobrança, estorno, RBAC, isolamento entre unidades, exclusão de veículos, token criptografado, assinatura/deduplicação do webhook, consentimento, templates, janela de atendimento, envio incerto e revogação do autor/conta. Usa PostgreSQL descartável e transporte Meta simulado; não envia mensagens reais.

Executar também a regressão completa com `npm run test:postgres` e o build do app antes de publicar. A auditoria de dependências registra sete alertas baixos na cadeia NFeWizard/xsd-assembler/deepmerge sem correção compatível disponível; não fazer downgrade automático do SDK fiscal.
