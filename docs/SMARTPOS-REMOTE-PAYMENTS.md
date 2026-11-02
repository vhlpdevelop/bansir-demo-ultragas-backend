# SmartPOS — contrato API/PDV para o APK (migração 052)

Base: `https://api-gas.bansir.com.br/api/v1`. Todos os endpoints exigem login de operador com acesso a vendas e estabelecimento selecionado. Use o fluxo de autenticação/refresh já existente do APK; não reutilize cookies do navegador. Após parear, envie também `X-Pdv-Terminal: pdvt_...` em todas as chamadas. Credencial de dispositivo não substitui autenticação do operador.

## Identidade e código

- Caixa/PDV: terminal lógico, um navegador e até uma SmartPOS por adquirente (`pagbank`, `mercadopago`, `caixa`). O caixa financeiro é compartilhado pelo terminal. Não abrir um caixa financeiro separado por maquininha.
- Administrador gera **código específico de SmartPOS**: `POST /pdv/terminals/:id/smartpos/activation`, `{ "provider":"pagbank", "replaceExisting":false }`. Para substituir a máquina da mesma adquirente, confirmar e enviar `replaceExisting:true`.
- Resposta: `{success:true,data:{id,code,expiresAt,clientType:"smartpos",provider}}`. `code` é STRING de seis dígitos, inclusive zeros iniciais; dez minutos, uso único. Nunca converter para inteiro.
- APK envia `POST /pdv/terminals/pair`, `{ "code":"048213", "clientType":"smartpos", "provider":"pagbank" }`. O provider é obrigatório. Código de navegador não pareia SmartPOS; código SmartPOS não pareia navegador; provider incorreto não consome o código. Não omitir `clientType` nem usar o cadastro Bridge.
- Salvar `data.token` com proteção Android Keystore, separado por ambiente/usuário/empresa/unidade. Não registrar código, token, bearer ou executionToken em logs. Mostrar ao operador o nome do caixa retornado e a adquirente.
- Pode adicionar uma SmartPOS com caixa aberto. Substituir/revogar a mesma adquirente fica bloqueado enquanto houver cobrança pendente. Pareamento não substitui navegador nem outra adquirente.
- Cinco falhas por usuário/unidade bloqueiam por quinze minutos (`429` e `Retry-After`). Não repetir tentativas em loop.

## Negociação obrigatória

`GET /pdv/terminals/capabilities` informa `version:2`, `remoteChargeCommands:true`, `remoteChargeVersion:1`, providers e seis dígitos.

Antes de receber cobranças, heartbeat:

```json
{
  "acquirerProvider":"PAGBANK",
  "appVersion":"versao-do-apk",
  "sdkVersion":"versao-real",
  "paymentSdkAvailable":true,
  "remoteChargeVersion":1,
  "plugPagAvailable":true
}
```

Enviar para `POST /pdv/terminals/heartbeat`, a cada ~20 segundos enquanto apto a operar. Adquirente informada deve corresponder ao vínculo; uppercase no diagnóstico, lowercase nas demais rotas. Declarar `remoteChargeVersion:1` **somente** com integração real, resultado durável, recuperação e todos os campos de evidência implementados. SDK ausente/incompatível/simulador: `paymentSdkAvailable:false`, omitir remoteChargeVersion. Nunca anunciar compatibilidade no simulador em produção. A API só permite criar cobrança com diagnóstico compatível e contato nos últimos 45 segundos.

## Receber comando — persistir antes de executar

`POST /smartpos/commands/next`, `{ "requestKey":"UUID-estavel-da-tentativa-de-recebimento" }`.

- Gerar e persistir esse UUID ANTES da chamada. Se houver perda da resposta, repetir o MESMO UUID. Retorna a mesma execução; não captura outro comando.
- `data:null`: nenhuma cobrança disponível; aplicar espera/backoff, não gerar chamadas concorrentes. Poll sugerido: 10–15 segundos ocioso, ou sinalização pela conexão existente seguida de consulta. Um consumidor/serviço por vínculo. Não exigir tela do APK permanentemente aberta: seguir as regras Android de foreground service e ciclo de vida do SDK.
- Comando: `{id,saleId,saleNumber,terminalId,provider,amountCents,method,installments,status,merchantReference,executionToken,expiresAt,...}`. `merchantReference` é o UUID do comando; passá-lo à adquirente como referência/idempotência sempre que o SDK permitir. Nunca usar número de cupom como chave global.
- Executar valor inteiro em centavos, BRL, método `credit_card` ou `debit_card`. Débito tem uma parcela. Crédito: parcelas informadas sem alterar valor ou acrescentar juros silenciosamente. Não substituir valor, método, parcelas, provider ou referência com dados da interface local.
- O SDK deve ser executado **uma vez por command.id**, com mutex persistente contra Activity recriada, duas telas ou serviço duplicado. Guardar localmente estados `received`, `execution_started`, `result_saved`, `result_acknowledged`.
- Persistir comando completo e executionToken antes de iniciar o SDK; persistir `execution_started` antes da chamada que pode cobrar; persistir o resultado antes de tentar enviá-lo à API.
- Um comando repetido não autoriza nova passagem de cartão. Com `executing`/`unknown` e registro local de execução iniciada, consultar a transação existente na adquirente. Se não for possível determinar o resultado, mostrar conferência necessária, mantendo o bloqueio. Não criar uma segunda cobrança.
- Não executar comando cujo resultado já foi confirmado ou que esteja cancelado/expirado/aprovado. Validade vencida depois que a execução iniciou significa **incerteza**, não recusa da adquirente.
- Sessão expirada: renovar autenticação e reenviar o resultado salvo. Não apagar registro local nem cobrar novamente ao refazer login ou reconectar.

## Devolver o resultado

`POST /smartpos/commands/:id/result`, exemplo fictício de aprovação:

```json
{
  "executionToken":"64-caracteres-hex-retornados-no-comando",
  "status":"approved",
  "provider":"pagbank",
  "method":"credit_card",
  "amountCents":10000,
  "installments":2,
  "transactionId":"identificador-real-estavel-da-adquirente",
  "nsu":"nsu-real",
  "authorizationCode":"autorizacao-real",
  "acquirerCnpj":"CNPJ-real-da-credenciadora-14-digitos",
  "brandCode":"codigo-fiscal-da-bandeira-2-digitos",
  "responseCode":"codigo-real-do-sdk"
}
```

- Estados aceitos: `approved`, `declined`, `cancelled`, `unknown`. Aprovação exige transação, NSU, autorização, CNPJ da credenciadora e bandeira fiscal. Não preencher valores de exemplo como se fossem reais. Mapear a bandeira pelos códigos oficiais e usar dados documentados do SDK/adquirente; CNPJ da credenciadora não é o da loja. `transactionId` precisa identificar unicamente a transação na adquirente; NSU isolado pode se repetir por dia/maquininha.
- Nunca enviar PAN completo, CVV, trilha, senha, chave de integração ou dump do objeto do SDK. O schema é fechado: campos extras são recusados. Mensagens devem ser sanitizadas. Credenciais da adquirente ficam no ambiente autorizado do APK/SDK, nunca no frontend web.
- Repetir EXATAMENTE o resultado salvo até receber confirmação; mesma resposta é idempotente. Resultado definitivo diferente dá `409 IDEMPOTENCY_CONFLICT`. Não mudar resultado para `declined` por timeout de rede.
- Transação da adquirente repetida em outro comando dá `ACQUIRER_TRANSACTION_REUSED`. Resultado de outra máquina, empresa, unidade, valor, método, parcelas, provider ou executionToken é rejeitado.
- Só aprovação válida registra pagamento e atualiza caixa/financeiro na mesma transação. Registro usa operador/caixa originais, preservando também usuário que recebeu/devolveu comando. Repetir callback não duplica recebimento, estoque nem comissão.
- `approved_review`: a adquirente aprovou, mas a liquidação no caixa não foi possível (por exemplo, alteração administrativa inesperada). Manter evidência, impedir nova cobrança e orientar conferência. **Não estornar nem cobrar de novo automaticamente.**
- O canal confia no APK/dispositivo pareado e em seu SDK. A API confere identidade, correspondência e unicidade das evidências; não é uma verificação independente na API bancária da adquirente.

## Fluxo no navegador

- Finalizar venda com `smartposProvider` e pagamento crédito/débito registra estoque/identificador de venda e cria a cobrança atomicamente. Se a máquina não estiver pronta, a transação inteira é revertida. Venda permanece **a receber** até aprovação. Não é autorização fiscal nem pagamento recebido.
- Venda já existente: `POST /sales/:id/smartpos` com `{requestKey,provider,method,amountCents,installments}`. Permite cobrar parte do saldo e completar outras formas sequencialmente; não há duas cobranças ativas da mesma venda.
- `GET /sales/:id/smartpos` lista estado, sem executionToken/credencial. `GET /pdv/smartpos/devices` lista máquinas do caixa do navegador com disponibilidade. O navegador não acessa a rota de coleta de comandos da SmartPOS.
- Cobrança ainda `queued`: pode cancelar antes de entrega em `POST /sales/:saleId/smartpos/:id/cancel`. Isso não cancela venda nem devolve estoque. A fila arbitra concorrência entre entrega e cancelamento; se já entregue, não declara cancelamento sem resultado do SDK.
- `queued` vencido após dois minutos torna-se `expired` e nunca é entregue. Execução vence após três minutos e torna-se `unknown`; não é reentregue a outra claim automaticamente. **Pode chegar aprovação depois desse tempo**, que será reconciliada no comando original.
- Enquanto queued/executing/unknown/approved_review, ficam bloqueados pagamento manual dessa venda, cancelamento operacional, fechamento do caixa, revogação/troca dessa máquina. Resultado definitivo deve vir do SDK após consulta da adquirente; não existe um botão para fingir recusa ou apagar cobrança incerta.
- O APK não deve iniciar cobrança autônoma paralela enquanto estiver atendendo comando remoto. Coordenar exclusão mútua com todos os modos de pagamento do aplicativo.
- Cancelamento fiscal SEFAZ, cancelamento de venda e estorno da adquirente são ações diferentes. Este contrato não implementa reembolso bancário nem estorno automático.
- Após aprovação, o recibo e a NFC-e usam cartão integrado (`tpIntegra=1`) e os dados estruturados da adquirente. Impressão automática do recibo remoto espera aprovação.

## Testes necessários no APK

Parear seis dígitos com zero inicial; coexistir navegador/duas adquirentes; negar provider errado; resultado de outro tenant/unidade; dois cliques/duas Activities; reinício antes/depois do SDK; resposta HTTP perdida no claim e no resultado; recusa; cancelamento do usuário; desligamento da rede após aprovação; APK antigo sem capacidade; SDK ausente; cobrança expirada antes da entrega; aprovação atrasada; cadastro revogado; sessão expirada/refresh; limpeza de dados com execução pendente. Usar sandbox/simulador em ambiente de testes, **sem cobranças reais para homologar o código**.

Migração 052 e frontend precisam estar publicados antes de testar a integração contra a API operacional. O contrato não altera o repositório `bansir-terminal`: o Gemini implementa o APK e entrega evidência dos testes de SDK antes de anunciar operação física pronta.
