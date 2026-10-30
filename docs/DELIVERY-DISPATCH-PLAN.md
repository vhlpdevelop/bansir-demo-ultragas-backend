# Proposta: pedidos, distribuição de entregas e indicadores

Estado: preparação para revisão, sem criar página, tabelas ou endpoints de entregas nesta etapa. Decisão do usuário em 30/10/2026: começar sem GPS em tempo real.

## O que existe e o que falta

Já existem entregadores ligados a funcionários e freelancers independentes, vendas com endereço e entregador atribuído, pedidos do link que geram venda e envio de rota por WhatsApp. A atribuição atual não comprova entrega concluída. Não há histórico operacional completo de saída, chegada, falha, tempo ou trajeto. Portanto, não podemos classificar desempenho, afirmar quantas entregas foram realizadas ou calcular economia real usando somente as vendas antigas.

O caixa continua pertencendo ao turno do terminal e ao operador responsável. Distribuir uma entrega não transfere caixa, terminal, receita ou permissão de receber valores. Status de pagamento e status de entrega são separados.

## Fluxo proposto

1. Administrador vê uma fila única de pedidos de entrega, vindos do PDV e do link, com venda como referência canônica para evitar duplicidade.
2. Informa entregadores disponíveis, em rota ou indisponíveis e, quando necessário, capacidade do veículo/carga e previsão de retorno. Freelancer não precisa virar funcionário.
3. Sistema agrupa pedidos compatíveis por região, prazo prometido e capacidade; sugere ordem das paradas e candidatos para cada conjunto.
4. Cada candidato mostra motivo da sugestão, quantidade já atribuída, acréscimo estimado de distância/tempo, histórico disponível e custo incremental estimado. A sugestão não altera pedidos nem envia mensagens.
5. Administrador revisa e confirma o plano. Controle de versão e idempotência impedem duas distribuições simultâneas do mesmo pedido. Pedido alterado/cancelado exige recalcular antes de confirmar.
6. Saída, entrega concluída, tentativa sem sucesso, retorno e reatribuição são registrados com responsável e horário. No início, o administrador pode registrar o resultado; confirmação pelo entregador pode ser implementada depois.

Página proposta: **Pedidos → Distribuição de entregas**, sem substituir o editor atual do link de pedidos. Filtros por status, região, entregador e data. Em desktop: fila, candidatos e resumo do plano; em celular: etapas de seleção, revisão e confirmação. Mapa é auxiliar, não requisito para operar a fila.

## Como sugerir sem GPS

Pontos de partida possíveis: loja, última parada confirmada ou ponto informado pelo administrador. Última entrega é apenas a última posição conhecida, com seu horário; nunca apresentar como posição atual rastreada. Se o dado estiver antigo, solicitar confirmação ou considerar o entregador retornando à base, com indicação explícita da hipótese.

Usar coordenadas confirmadas dos endereços e uma estimativa de deslocamento por vias. Distância em linha reta, quando for a única disponível, deve ser identificada como aproximação e não tratada como rota de trânsito ou custo preciso. Endereços incompletos ou geocodificação incerta ficam pendentes de conferência; não alterar cadastro automaticamente.

Sugestão inicial por inserção de menor custo em rotas existentes, respeitando disponibilidade, capacidade, prazo e limite de paradas. Comparar o acréscimo provocado por incluir o pedido, não apenas a distância da loja até o cliente. Histórico ajuda como desempate e estimativa de tempo de atendimento, sem penalizar quem tem poucos dados ou atua em regiões mais difíceis. Mostrar quantidade de amostras e permitir escolha manual justificada.

Não prometer solução matemática global ótima, trânsito em tempo real ou localização atual. Após confirmar cada entrega, atualizar o histórico para melhorar sugestões futuras.

## Dados a preparar na implementação futura

- Entrega: tenant/unidade, venda de origem, endereço confirmado, coordenadas e qualidade da localização, janela prometida opcional, carga estimada e status operacional.
- Planejamento: rota, entregador, ponto inicial e sua origem/horário, paradas ordenadas, distâncias/tempos estimados, versão do cálculo e prazo de validade da proposta.
- Execução: atribuído, separado, saiu, entregue, tentativa sem sucesso, cancelado e retornou; eventos auditados com quem registrou, quando registrou e horário do fato quando diferente. Reatribuição preserva o histórico anterior.
- Custos configuráveis: custo por km, custo de tempo opcional, pedágio quando conhecido e regra específica para freelancer. Sem parâmetros suficientes, custo aparece como indisponível, não zero. Valor estimado e gasto realizado ficam separados.
- Medições reais opcionais: hodômetro inicial/final e despesas vinculadas à rota, com validação. Não usar a estimativa de trajeto como prova de quilometragem percorrida.

## Dashboard futura

Mostrar pedidos aguardando entregador, em preparação, em rota e concluídos confirmados hoje; carga atual de cada entregador; tempo médio/mediano quando houver horários suficientes; atrasos apenas quando existir prazo registrado; falhas e reentregas. Exibir km/custo estimados e realizados em grupos distintos, com cobertura dos dados. Comparação de economia exige uma base de comparação armazenada; não inventar porcentagem de economia.

Entregas históricas sem confirmação ficam identificadas como registros legados atribuídos, sem aumentar contagem de concluídas. Indicadores operacionais podem aparecer no dashboard para administradores e usuários com direito explícito de dashboard; dados financeiros continuam respeitando o escopo autorizado. Nenhum indicador novo de desempenho será adicionado antes da captura dos eventos correspondentes.

## Recursos e integrações

Começar com processamento sob demanda ao clicar em sugerir/recalcular, reaproveitando endereço confirmado e resultados de roteamento em cache com validade e versão. Evitar recalcular todas as combinações em cada atualização da tela. Calcular matriz de trajetos em lote quando suportado e limitar tamanho do plano. O estado da operação fica no PostgreSQL; SSE existente pode avisar sobre mudanças autorizadas, e REST recupera dados duráveis.

Não há escolha de fornecedor de mapas/roteamento nem autorização de contratação nesta proposta. Antes de integrar, avaliar cobertura local, precisão, limites, armazenamento permitido e custo por volume esperado. GPS em tempo real, assinatura paga de mapas, otimizador dedicado e Redis ficam fora desta primeira etapa.

## Permissões e critérios de aceite

Administrador ou usuário com direito de gestão de entregas confirma distribuição. Entregador autenticado vê apenas suas entregas e os dados necessários ao atendimento; freelancer pode continuar sob gestão do administrador. Todo acesso usa unidade e usuário da sessão, sem confiar em IDs enviados pelo cliente. Não exibir caixa ou vendas de terceiros por possuir vínculo de terminal.

Testar: isolamento de lojas, motorista inativo, freelancer, endereço sem coordenada, falta de capacidade, dois gestores atribuindo o mesmo pedido, reenvio idempotente, cancelamento durante planejamento, devolução/reentrega, indisponibilidade do roteador, falha de rede na confirmação e preservação de caixa/pagamentos. Nenhuma mensagem de WhatsApp deve sair ao apenas visualizar uma sugestão.

Próxima etapa, após revisar esta proposta: definir capacidade/custo por veículo e forma inicial de confirmação de entrega; detalhar contrato e migrações antes de codificar a página.
