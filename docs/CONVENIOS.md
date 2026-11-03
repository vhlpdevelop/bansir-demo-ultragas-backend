# Convênios

Migrações 058 e 059. O worker `notification` agenda os lembretes com `FINANCIAL_ALERTS_ENABLED=true`, junto dos lembretes financeiros existentes.

## Operação

- Clientes → Convênios: cadastrar a empresa pagadora (um cadastro de cliente existente), corte, vencimento, limites e participantes. Cada cliente tem um vínculo principal ativo por estabelecimento.
- PDV: selecionar o cliente sugere A receber quando o atendente ainda não escolheu outra forma. Somente A receber / A prazo vincula a compra ao grupo. Pagamentos imediatos e cobrança na entrega permanecem no fluxo comum.
- Financeiro → Convênios: conferir extrato por período, baixar demonstrativo PDF, fechar e distribuir um recebimento entre vendas. A confirmação de recebimento exige caixa aberto no terminal atual. O demonstrativo não é documento fiscal.
- Limites e atraso são conferidos na API, sob trava por estabelecimento. Uma alteração de vínculo afeta compras futuras; snapshots preservam o pagador e as condições originais. O pagador não pode mudar depois da primeira compra: nesse caso, cadastrar outro convênio.
- Fechamento não registra pagamento nem emite notas. Após o fechamento, novas compras são atribuídas ao próximo período aberto.
- Recebimentos utilizam `sale_payments` e o caixa do recebedor, sem outra venda ou entrada financeira duplicada. Cancelamentos usam o fluxo existente de vendas e estorno; o saldo do extrato exclui vendas canceladas.

## Acesso

Administradores têm todas as ações. Permissões específicas: `agreements-use`, `agreements-view`, `agreements-manage`, `agreements-close` e `agreements-collect`. Permissões `financial` ou `financial-receivables` permitem consultar, sem conceder baixa ou edição de convênio. O painel Bansir controla a função contratada `agreements`; desligá-la impede novas compras e configurações, preservando consulta e recebimento de saldos históricos.

## Avisos

Avisos diários por grupo/período/destinatário: fechamento pendente, vencimento ou atraso, priorizando atraso. Usam central persistida e push opcional; a permissão e o saldo são revalidados antes do push. Vendas do convênio são excluídas do lembrete financeiro comum. O link da central abre o grupo e período.

Vendas comuns continuam no lembrete diário quando possuem saldo e vencimento até hoje. Pendências sem vencimento não são classificadas automaticamente como atrasadas. Nenhuma cobrança é enviada automaticamente ao cliente.

## Validação

`node scripts/test-postgres.js test/agreements.integration.test.js test/pdv.integration.test.js test/workers.integration.test.js test/platform-admin.integration.test.js`

Os testes usam banco descartável: RBAC, isolamento, concorrência de limites, idempotência, alocação parcial, rollback, cancelamento, preservação de destinatário fiscal e lembretes sem duplicação. Não é necessário criar vendas ou notas reais para validar o módulo.
