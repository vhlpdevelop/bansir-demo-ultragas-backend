# Caixa de entrada, push e lembretes

A notificação é persistida na mesma transação que cria o job (outbox). O sininho lê a caixa de entrada independentemente da entrega push. Push exige permissão no navegador, assinatura válida e VAPID; aceitar a mensagem no provedor não comprova exibição no dispositivo. O worker usa PostgreSQL com pool de três conexões, claim com lease, renovação e retry; não é necessário criar outro pool para o navegador.

O frontend consulta a cada 25 segundos enquanto visível, atualiza ao recuperar foco/visibilidade e ao receber mensagem do service worker. Consultas não se sobrepõem; respostas de uma unidade anterior são descartadas ao trocar o contexto. Falha temporária preserva os avisos e informa que haverá nova tentativa. O recebimento do push avisa abas abertas para consultar a API; isso não muda automaticamente o estabelecimento selecionado. Publicar o build completo preparado para S3 é necessário para ativar essa melhoria na interface.

## Financeiro

Migração 038 adiciona resumo diário para contas a pagar/receber com vencimento hoje ou anterior. Inclui lançamentos manuais pendentes e vendas com saldo, data de vencimento e sem cancelamento. Contas pagas/canceladas, datas futuras e vendas sem vencimento não entram no resumo. Fuso vem da configuração da unidade, com fallback America/Cuiaba. Não gera um aviso para cada alteração financeira: é um lembrete de vencimentos. Um resumo por dia, unidade, tipo e destinatário; nova execução não duplica. Não altera saldo, vencimento nem status de conta.

Destinatários ativos: administradores/superadmin ou permissões financial/financial-payables/financial-receivables conforme o tipo. Não inclui usuário apenas com financial-overview. Permissões são verificadas novamente antes de enviar o push. O corpo não inclui valores financeiros nem dados de clientes. Ativação: FINANCIAL_ALERTS_ENABLED=true no serviço notifications; desativar impede novos resumos, sem apagar a caixa de entrada. O usuário autorizou a ativação em produção em 30/10/2026.

## Fiscal

Produtores existentes cobrem nova nota de fornecedor/cancelamento recebido na distribuição fiscal, falha de consulta, certificado perto do vencimento, NFC-e autorizada, rejeitada, incerta ou em revisão. Dependem de certificado, monitor e processamento configurados; não significam que todo upload/importação manual de qualquer arquivo emita aviso. Destinatários fiscais obedecem configuração fiscal e permissão fiscal-notify; a permissão é revalidada no push. O worker fiscal não foi alterado nesta etapa, nem a configuração que impede emissão em produção.

## Falhas e observabilidade

404/410 do provedor desativam assinatura expirada. Falhas de rede/429/5xx geram retry; rejeição permanente encerra o job. Aviso permanece na caixa de entrada. Sem VAPID, worker continua agendando/persistindo e conclui a etapa sem push, com log explícito. Reativar VAPID não reenvia automaticamente jobs já concluídos nesse modo. Falha no agendador não bloqueia consumo da fila.

Validação automatizada usa banco descartável e transporte push simulado: deduplicação, rollback, leases, retries, assinatura expirada, revogação de usuário, produtores fiscais e lembretes financeiros. Conferência de produção usa logs, configuração sem valores secretos e contagens agregadas. Não enviar push de teste a usuário real sem solicitação. Um teste final no navegador deve ativar a permissão em Configurações e usar o botão de teste no próprio dispositivo.
