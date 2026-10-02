# Pagamentos e notas — implementação de testes

Implementado em 28/09/2026. Frontend no Netlify, API e worker no Render, estado no MongoDB. Este módulo oferece demonstração completa e adaptadores de homologação. **Não está liberado para cobranças ou notas de produção.**

## O que está disponível

- `nfewizard-io` 1.1.4 para NF-e, `@nfewizard/nfce` 1.0.6 para NFC-e e `@nfewizard/danfe` 1.0.7 para PDF fiscal. Versões fixadas no lockfile; `node-dfe` removido.
- Carrinho com preços lidos do catálogo pela API, crédito/débito e solicitação de 1–12 parcelas no crédito.
- Operação persistente, referência UUID e idempotência por usuário/requestId. Repetir a mesma requisição retorna o mesmo pedido; mudar o conteúdo com a mesma chave retorna 409.
- Fila no próprio documento MongoDB; claim atômico, lease e recuperação de interrupção. Nenhuma transação MongoDB fica aberta enquanto aguarda o provedor.
- Confirmação por consulta autenticada de pedido e transações da Cielo. Confere referência, valor líquido, modalidade e parcelas. Um webhook ou `status=PAID` sozinho não confirma pagamento.
- Estados independentes de pagamento e documento. Repetir a emissão nunca cria outra cobrança. Resultado incerto exige consulta, sem reenvio automático.
- Painel com filtros, histórico, parcelas informadas pela Cielo, ações de recuperação, rascunho fiscal administrativo, XML/DANFE autorizado e relatório PDF gerado pela API.
- Operador acessa apenas suas operações; administrador acessa todas. Credenciais e arquivos fiscais internos não são retornados nas listagens.

## Testar a demonstração publicada

1. Publicar **backend e frontend** juntos. No backend: `npm ci` e `npm start`. No Netlify: `npm ci` e `npm run build`, publicando `dist`.
2. Manter `INTEGRATION_MODE=demo` no Render (também é o padrão na ausência da variável).
3. O frontend deve continuar com `VITE_API_URL=https://bansir-demo-caroline-backend.onrender.com/api/v1`. Não substituir pela URL local do servidor descartável usado nos testes automatizados.
4. Entrar em **Pagamentos e notas**, selecionar um produto cadastrado, quantidade, modalidade, parcelas e modelo 55/65.
5. Executar os cinco cenários: sucesso, recusa, timeout do pagamento, rejeição fiscal e timeout fiscal.
6. Em timeout de pagamento, usar **Consultar pagamento**. Em rejeição fiscal, **Tentar somente a nota**. Em timeout fiscal, **Consultar nota**.
7. Baixar **Relatório PDF**. Na demo, ele é marcado sem valor fiscal e não apresenta chave/protocolo inventados.

Os testes não criam `Sale`, recebíveis, movimentos de estoque nem notas na coleção fiscal legada. As operações ficam em `checkoutoperations`. O painel marca explicitamente os resultados simulados.

## Configuração de homologação no Render

Usar `INTEGRATION_MODE=homologation` e preencher as variáveis do `.env.example`:

| Variável | Finalidade |
|---|---|
| `CIELO_CLIENT_ID` | Identificador da aplicação Sandbox |
| `CIELO_ACCESS_TOKEN` | Token Sandbox |
| `CIELO_MERCHANT_ID` | Identificação/configuração de estabelecimento exigida na integração Sandbox |
| `FISCAL_CNPJ` | Emitente de 14 dígitos, sem pontuação |
| `FISCAL_CERT_PATH` | Caminho privado do arquivo A1 PFX, por exemplo `/etc/secrets/certificado.pfx` |
| `FISCAL_CERT_PASSWORD` | Senha do certificado, somente no backend |
| `FISCAL_CSC_ID`, `FISCAL_CSC_TOKEN` | CSC de homologação para NFC-e em MS |
| `FISCAL_SERIES` | Série exclusiva para estes testes; padrão 1 |

Os certificados não podem ser enviados ao Netlify nem ao Git. O painel mostra apenas os nomes das configurações ausentes. Presença de variável não significa credencial validada.

O endpoint Cielo é fixado em `https://api.cielo.com.br/sandbox-lio/order-management/v1`. A SEFAZ usa `tpAmb=2` e UF MS. `INTEGRATION_MODE=production` é rejeitado, inclusive no startup.

### Fluxo externo de homologação

1. Criar o pedido pelo painel. A API usa `/orders` e salva o identificador externo.
2. Usar **Simular pagamento na Cielo Sandbox**, disponível ao administrador. O POST de transação é seguido por GET do pedido e das transações; o POST sozinho não marca pago. Não há maquininha física nesse ambiente.
3. O worker consulta pagamentos pendentes a cada minuto, por até 20 tentativas. O botão de consulta continua disponível depois desse limite. O primeiro agendamento ocorre em aproximadamente 30 segundos.
4. Depois da confirmação, **Preparar dados fiscais** gera um rascunho NFeWizard a partir do carrinho. Preencher emitente, destinatário da NF-e, NCM, CFOP, impostos e totais com revisão contábil.
5. Salvar e usar **Emitir em homologação**. A API fixa identificação, série, número, chave, ambiente e pagamento. O editor faz validações de vínculo e valores; a validação XSD e a autorização ocorrem no fluxo NFeWizard/SEFAZ.
6. Baixar XML e DANFE apenas após protocolo válido. O `success` da biblioteca não basta: a aplicação exige protocolo individual 100/150, chave correspondente e ambiente 2.

**Tributação:** esta entrega não contém um motor tributário automático nem um cadastro fiscal completo por produto. O rascunho é um editor técnico para validar a integração, limitado a vendas internas em MS, sem descontos/frete adicionais ao carrinho. Não copiar uma tributação de exemplo para uma loja real. As exigências de IBS/CBS e demais grupos devem ser preenchidas conforme o enquadramento e leiaute aplicáveis.

**Parcelas:** a solicitação não comprova as parcelas efetivamente realizadas. A aplicação confere `payment_fields.number_of_quotas` e modalidade retornados. Ausência/divergência deixa a operação em revisão e bloqueia a emissão. Este módulo não calcula taxas contratuais nem a agenda de liquidação da Cielo.

### Webhook e conciliação

URL: `POST /api/v1/operations/cielo/notifications`. Cadastrar essa URL no fluxo de integração Cielo quando houver conta apropriada. Recebe `id` ou `order_id`, encontra somente pedidos conhecidos e agenda uma consulta autenticada. Ignora status, valor e transações enviados no corpo. Há debounce de um minuto por pedido; o polling não depende do webhook.

Após timeout ao criar pedido, o sistema consulta pela referência original; não tenta criar automaticamente outro pedido. Resultado não localizado ou duplicado fica pendente de análise no portal Cielo.

Após timeout fiscal, consulta a mesma chave. Códigos de lote, duplicidade, serviço indisponível e 217 não são tratados como autorização nem liberam reenvio automático. Cancelamento/denegação não liberam reutilização da numeração.

Se a biblioteca lançar apenas texto de rejeição sem protocolo estruturado, o painel exibe a frase fiscal, mas conserva estado incerto até a consulta. Falha na inicialização do certificado/SDK antes da submissão permite corrigir a configuração e tentar apenas a nota.

## Persistência e limites atuais

O XML autorizado retornado pela biblioteca e os dados do documento são salvos no MongoDB, fora dos campos públicos. Arquivos temporários da biblioteca são removidos após a execução. Existe uma janela entre a autorização externa e a persistência: se o processo morrer nesse intervalo, a consulta pode recuperar o protocolo sem recuperar o XML assinado. Nesse caso a aplicação **não fabrica XML ou DANFE**. Antes de produção, implementar persistência do XML assinado antes da transmissão e recuperação/backup dos documentos.

Numeração é incrementada atomicamente por ambiente/CNPJ/modelo/série em `integrationfiscalsequences`. Números reservados não são reciclados. Usar série que não esteja sendo consumida por outro emissor e preservar a coleção. O fluxo de inutilização ainda não está conectado ao painel.

Ainda faltam para liberar produção: homologação efetiva em MS e Cielo Smart; cadastro e cálculo tributário; reserva/baixa de estoque e criação de venda/recebíveis transacionais após confirmação; agenda de recebíveis; cancelamento fiscal, estorno e devolução; contingência offline; retenção e recuperação documental. As rotas antigas de venda manual continuam independentes e não devem ser usadas como confirmação automática de uma cobrança Cielo.

## Testes executáveis

```sh
npm ci
npm test
npm run test:operations
```

`test:operations` usa `mongodb-memory-server`, baixa um binário MongoDB na primeira execução e cria banco descartável. **Não usa MONGODB_URI da loja.** Cobre concorrência/idempotência, autorização HTTP, preços do catálogo, leases, PDF, isolamento de estoque, webhooks falsos, recusas, rejeições e timeouts. Provedores externos são substituídos por respostas controladas nos testes de fluxo. Há teste de falha segura dos pacotes instalados com certificado fictício inexistente; isso não comprova autorização na SEFAZ.

Para inspecionar visualmente a aplicação com dados descartáveis:

```sh
# backend; somente loopback, MongoDB descartável
npm run preview:operations
```

Em outro terminal PowerShell, dentro de `app`:

```powershell
$env:VITE_API_URL='http://127.0.0.1:5101/api/v1'
npm.cmd run dev -- --host 127.0.0.1 --port 5178
```

Login exclusivo desse processo: `preview@bansir.test` / `Preview-only-2026`. Não é uma conta do Render. Encerrar os terminais apaga os dados temporários. Não definir essa URL em arquivos de ambiente ou no Netlify.

## Dependências e referências

Os pacotes NFeWizard usam GPL-3.0. A auditoria após remover `node-dfe` apontou duas ocorrências altas na cadeia `nfewizard-io → nodemailer`, sem correção automática indicada pelo npm. O módulo não configura nem utiliza envio de email; revisar a atualização/licenciamento antes de distribuição em produção.

- [NFeWizard: código e documentação](https://github.com/nfewizard-org/nfewizard-io)
- [Cielo: ambientes Sandbox/produção](https://docs.cielo.com.br/cielo-smart/reference/ambientes-sandbox-e-producao)
- [Cielo: criação de pedidos](https://docs.cielo.com.br/cielo-smart/reference/criar-um-pedido)
- [Cielo: transação simulada, apenas Sandbox](https://docs.cielo.com.br/cielo-smart/reference/adicionar-uma-transacao)
- [Cielo: manual, transações e notificações](https://developercielo.github.io/manual/cielo-lio)
