# Caixa por terminal e avisos locais

O turno de caixa mantém terminal lógico, operador responsável e horários imutáveis de abertura/fechamento. O vínculo do navegador não substitui a sessão do operador. Outra sessão da mesma conta sem o vínculo não recebe pop-up de expediente; continua sujeita às validações de terminal nas operações do PDV.

GET /pdv/terminal-notice exige permissão de vendas e o X-Pdv-Terminal validado na unidade. Sem vínculo, retorna data:null, inclusive se o usuário tiver caixa aberto em outro navegador. Vínculo revogado/de outra loja é recusado. Informa apenas terminal, turno aberto, responsável, se o turno é do operador e horário de funcionamento; não transmite saldo de outro operador. Também informa se o operador tem outro caixa aberto para evitar sugerir abertura incompatível.

Pop-up global da aplicação autenticada, usando o horário da loja: abertura durante expediente e aviso de fechamento a dez minutos do fim ou após o expediente. Nos dez minutos finais, caixa fechado não recebe sugestão automática de reabrir. Dias não configurados/desabilitados não geram aviso de expediente. Turnos atravessando meia-noite mantêm a mesma chave de deduplicação. Avisos são locais, não entram na caixa de notificações da conta nem no push. Registro local por usuário/terminal/expediente evita repetição; Web Locks coordena abas do perfil quando disponível. Outro operador com caixa no mesmo terminal recebe orientação sobre o responsável, sem ação de fechamento em seu nome.

GET /dashboard e GET /dashboard/terminal-cash exigem direito dashboard no backend. Retornam os terminais da unidade, caixas abertos, operador, abertura e dinheiro esperado. Cálculo: fundo + movimentos de entrada − estornos em dinheiro − sangrias. Pix e cartão não entram no dinheiro físico esperado. Valor esperado não significa conferência física realizada. Caixas legados sem terminal aparecem como total separado, sem atribuição retroativa. Turnos fechados não mantêm saldo exibido como atual.

Dashboard carrega os indicadores completos inicialmente/por ação manual; atualização automática de 30s, enquanto visível, consulta somente o resumo de caixas. Mostra horário dessa consulta, preserva RBAC/RLS e permite refresh ao recuperar foco. Não é uma promessa de atualização instantânea nem substitui a contagem no fechamento.

Validação em banco descartável: saldos de fundo/movimentos, cartão excluído do dinheiro físico, isolação de lojas, ausência de pop-up sem vínculo, proprietário do caixa e dashboard negada sem direito/liberada com direito explícito. Prévia com conta fictícia confirmou pop-up após vínculo, fechamento em cinco minutos e caixa de R$50 renderizado na dashboard. Nenhum caixa ou venda real foi criado para teste.

Entrega futura: planejamento em DELIVERY-DISPATCH-PLAN.md, sem GPS em tempo real nesta primeira proposta; captura de eventos operacionais deve preceder ranking e indicadores de entregas concluídas. Esta etapa não cria a página de distribuição.
