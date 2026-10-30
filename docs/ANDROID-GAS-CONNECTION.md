# Conexão do Bansir Terminal à API Gás

Base de produção: `https://api-gas.bansir.com.br/api/v1`.

O cliente operacional é `core-domain/.../gas/GasApiClient.kt`. ActivationApi, OperatorSessionApi e TerminalOrderApi continuam contratos do mock; a API PostgreSQL não autentica por PIN nem aceita os headers de operador desses mocks como identidade.

## Fluxo disponível

Login por e-mail/senha → seleção de estabelecimento se necessária → GET /pdv/terminals → pareamento com código emitido por administrador em Configurações → Terminais → abertura de caixa → consulta/recebimento de vendas → recibo PDF 58mm → fechamento. Todas as chamadas operacionais exigem Bearer do operador; operações de caixa exigem adicionalmente X-Pdv-Terminal. Logout não revoga o vínculo da instalação.

Não enviar X-Bansir-Client: browser no Android. Refresh rotativo continua explícito em JSON, com prazo absoluto; guardar no Keystore. Troca de senha retorna `changed`, `requiresLogin: true` e `user` para compatibilidade com o parser atual do APK. Encerrar a sessão do operador e solicitar novo login; a troca revoga todas as sessões antigas.

## Pareamento independente (migração 037)

POST /pdv/terminals/pair aceita:

```json
{"code":"CODIGO_HEXADECIMAL_24_CARACTERES","clientType":"smartpos"}
```

Retorna o mesmo `{success,data:{id,name,token}}`. O slot SmartPOS é independente do navegador. Cada slot tem no máximo uma instalação; novo pareamento revoga apenas a anterior do mesmo tipo. Sem clientType, permanece o comportamento legado de substituição do navegador. **O GasApiClient atual envia apenas code**: para aproveitar coexistência, Gemini deve acrescentar clientType smartpos e ajustar a confirmação de substituição do navegador. Não inferir tipo por User-Agent, número de série ou Android ID.

O administrador ainda gera o código de uso único, por dez minutos. Alteração de vínculo durante caixa aberto exige recuperação administrativa justificada, como no fluxo existente. Os dois clientes usam o mesmo terminal lógico e as regras atuais: um caixa por terminal/operador; outro operador não ganha acesso ao caixa só por possuir o token da instalação. Desativar o terminal revoga ambos os slots. Vínculos existentes são preservados na migração.

GET /pdv/terminals/capabilities informa independentBindings e clientTypes. A lista de terminais inclui aliases esperados pelo APK: status, open_cash_id, open_cash_user_id, open_cash_operator_name, last_seen_at e smartpos_paired, sem hashes/credenciais. bindingError continua string para o frontend publicado; novo bindingErrorDetail oferece `{code,message}`. No Android, ler bindingErrorDetail primeiro e limpar somente o vínculo da unidade em TERMINAL_REVOKED.

POST /pdv/terminals/heartbeat, com Bearer e token SmartPOS, aceita diagnóstico opcional:

```json
{"acquirerProvider":"PAGBANK","appVersion":"0.1.0","sdkVersion":"1.35.0","plugPagAvailable":true}
```

Resposta data contém id e lastSeenAt. Diagnóstico é declaração do aplicativo, não atestação de hardware nem prova de pagamento. Nenhuma credencial da adquirente deve ser enviada nesses campos.

## Pagamentos e limites atuais

O contrato já usado pelo GasApiClient em POST /sales/:id/payments permanece estrito: requestKey UUID estável, method cash/pix/credit_card/debit_card, confirmed true, amountCents, reference até 200 caracteres, receivedCents em dinheiro e installments no crédito. Repetição idêntica retorna a venda; alteração de conteúdo com a mesma chave é conflito. Saldo, autoria/permissões, unidade e caixa são validados no servidor.

O APK mantém evidência completa localmente e envia a referência compacta já implementada. Não há nesta etapa endpoint dedicado de evidência, reserva de tentativa ou comando remoto de cobrança Web → SmartPOS. A presença de dois vínculos não cria essa fila. Não enviar SIMULATOR à produção; resultado UNKNOWN exige conciliação antes de repetir cobrança. Cancelamento da venda exige gestão e confirmação de estorno já feito; não executa estorno no SDK. Voucher não foi mapeado artificialmente para dinheiro/cartão.

Testes usam contas e banco descartáveis. Teste final no hardware PagBank e conciliação com o SDK continuam necessários; não emitir documento fiscal ou cobrar cliente real para verificar conectividade.
