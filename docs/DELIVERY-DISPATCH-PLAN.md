# Proposta: pedidos, distribuição de entregas e indicadores

Estado: primeira versão operacional implementada em 30/10/2026. O guia [DELIVERY-OPERATIONS.md](DELIVERY-OPERATIONS.md) descreve o que foi entregue, os endpoints e os limites. Esta proposta permanece como roteiro para evolução: roteamento por vias, agrupamento de paradas e custos ainda não foram implementados. Por decisão do usuário, guardamos SOMENTE a última posição do entregador, sem histórico de coordenadas. O PWA acompanha durante uso ativo; não garante coleta com tela bloqueada.

## O que existe e o que falta

Já existem entregadores ligados a funcionários e freelancers independentes, vendas com endereço e entregador atribuído, pedidos do link que geram venda e envio de rota por WhatsApp. A atribuição atual não comprova entrega concluída. Não há histórico operacional completo de saída, chegada, falha, tempo ou trajeto. Portanto, não podemos classificar desempenho, afirmar quantas entregas foram realizadas ou calcular economia real usando somente as vendas antigas.

O caixa continua pertencendo ao turno do terminal e ao operador responsável. Distribuir uma entrega não transfere caixa, terminal, receita ou permissão de receber valores. Status de pagamento e status de entrega são separados.

## Fluxo proposto

1. Administrador vê uma fila única de pedidos de entrega, vindos do PDV e do link, com venda como referência canônica para evitar duplicidade.
2. Entregador inicia seu expediente no PWA e pode compartilhar localização; administrador acompanha disponibilidade, carga e previsão de retorno. Posição recente é opcional para sugerir distribuição. Freelancer não precisa virar funcionário, mas precisa de identidade própria vinculada para autenticar e registrar suas entregas.
3. Sistema agrupa pedidos compatíveis por região, prazo prometido e capacidade; sugere ordem das paradas e candidatos para cada conjunto.
4. Cada candidato mostra motivo da sugestão, quantidade já atribuída, acréscimo estimado de distância/tempo, histórico disponível e custo incremental estimado. A sugestão não altera pedidos nem envia mensagens.
5. Administrador revisa e confirma o plano. Controle de versão e idempotência impedem duas distribuições simultâneas do mesmo pedido. Pedido alterado/cancelado exige recalcular antes de confirmar.
6. Saída, entrega concluída, tentativa sem sucesso, retorno e reatribuição são registrados com responsável e horário. O entregador pode registrar o resultado de suas próprias entregas pelo PWA; o administrador pode corrigir com justificativa e auditoria.

Página proposta: **Pedidos → Distribuição de entregas**, sem substituir o editor atual do link de pedidos. Filtros por status, região, entregador e data. Em desktop: fila, candidatos e resumo do plano; em celular: etapas de seleção, revisão e confirmação. Mapa é auxiliar, não requisito para operar a fila.

## Como sugerir com e sem posição recente

Pontos de partida possíveis: posição recente e com precisão aceitável compartilhada durante o expediente, loja, última parada confirmada ou ponto informado pelo administrador. Última entrega é apenas a última posição conhecida, com seu horário; nunca apresentar como posição atual rastreada. Se o dado estiver antigo, solicitar confirmação ou considerar o entregador retornando à base, com indicação explícita da hipótese.

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

Não há escolha de fornecedor de mapas/roteamento nem autorização de contratação nesta proposta. Antes de integrar, avaliar cobertura local, precisão, limites, armazenamento permitido e custo por volume esperado. Coleta de posição pelo PWA durante uso ativo entra no escopo proposto. Rastreamento contínuo com tela bloqueada, assinatura paga de mapas, otimizador dedicado e Redis ficam fora desta primeira etapa.

## Permissões e critérios de aceite

Administrador ou usuário com direito de gestão de entregas confirma distribuição. Entregador autenticado vê apenas suas entregas e os dados necessários ao atendimento; freelancer pode continuar sob gestão do administrador. Todo acesso usa unidade e usuário da sessão, sem confiar em IDs enviados pelo cliente. Não exibir caixa ou vendas de terceiros por possuir vínculo de terminal.

Testar: isolamento de lojas, motorista inativo, freelancer, endereço sem coordenada, falta de capacidade, dois gestores atribuindo o mesmo pedido, reenvio idempotente, cancelamento durante planejamento, devolução/reentrega, indisponibilidade do roteador, falha de rede na confirmação e preservação de caixa/pagamentos. Nenhuma mensagem de WhatsApp deve sair ao apenas visualizar uma sugestão.

Próxima etapa, após revisar esta proposta: definir capacidade/custo por veículo e forma inicial de confirmação de entrega; detalhar contrato e migrações antes de codificar a página.


## Localização do cliente no link de pedidos

O link atual coleta endereço; as coordenadas existentes são da loja, não do destino. Acrescentar botão **Usar minha localização** no pedido de entrega, após ação do cliente. Solicitar permissão apenas nesse momento. Mostrar precisão e pedir confirmação: a posição do celular pode não ser o endereço onde o cliente deseja receber. Permitir confirmar/ajustar o ponto quando houver mapa e manter rua, número, bairro, complemento e referência.

Coordenadas ajudam a distribuição, mas não são obrigatórias para concluir um pedido com endereço válido. Sem permissão, sem suporte ou com erro, oferecer endereço manual e conferência pela loja. Retirada não exige localização. Uma captura consentida do destino basta; não rastrear o cliente durante a compra. Salvar origem do ponto, latitude/longitude, precisão, instante da captura e confirmação do destino como snapshot do pedido; alteração de destino após atribuição requer validação/replanejamento auditado. Não sobrescrever automaticamente o cadastro permanente do cliente.

Coordenadas de clientes não entram na configuração pública da loja, listas públicas ou payloads push/NOTIFY. Somente o cliente no contexto do seu pedido, a loja autorizada e o entregador atribuído têm acesso necessário ao destino. A cobrança de frete permanece calculada no servidor; coordenadas fornecidas pelo cliente não autorizam preços, regiões ou descontos por conta própria.

## PWA do entregador: fluxo simples

Tela **Minhas entregas**, separada do PDV e do caixa: iniciar expediente, ativar compartilhamento, ver os pedidos atribuídos, abrir navegação, registrar saída, marcar entregue ou tentativa sem sucesso, pausar e encerrar expediente. Pedido entregue não significa pago: o resultado operacional não baixa saldo nem cria recebimento. Distância do ponto pode auxiliar, mas não confirma entrega automaticamente.

No início, exibir explicação do compartilhamento e indicador persistente enquanto ativo. Solicitar permissão e testar uma posição recente antes de indicar que o envio está funcionando. Finalizar turno ou desligar compartilhamento deve chamar clearWatch e encerrar o coletor no backend. Não iniciar rastreamento silenciosamente no login, nem manter coleta fora do expediente. A conclusão deve funcionar sem localização quando a política da loja permitir, registrando a ausência de sinal em vez de inventar coordenadas; eventual exigência de posição para concluir precisa de exceção auditada para operação sem cobertura.

No PWA não é possível atestar simplesmente que o botão físico GPS está ligado. A permissão do site, a obtenção de uma posição, sua precisão e o recebimento no servidor são verificações diferentes. A posição pode vir de rede/Wi-Fi, não exclusivamente de satélite. Estados propostos: aguardando permissão, solicitando posição, compartilhando com posição recente, precisão insuficiente, permissão negada, posição indisponível, timeout, sem conexão e compartilhamento pausado/encerrado. Não rotular silêncio como GPS desligado ou ação deliberada do entregador.

O navegador pode suspender a página quando ela fica oculta, o celular bloqueia ou o PWA fecha. Instalar o PWA, manter SSE ou usar service worker não garante geolocalização contínua em segundo plano. Ao recuperar uso ativo, revalidar sessão, permissão e posição; intervalo sem amostras fica visível como lacuna. Se continuidade com tela bloqueada for requisito obrigatório, projetar aplicativo nativo apropriado no celular do entregador, com permissões e gestão de ciclo de vida próprias. Não confundir esse aplicativo com a maquininha bansir-terminal/SmartPOS.

## Dashboard do administrador

Além dos indicadores de entregas previstos, incluir mapa/lista de entregadores com status de trabalho, pedidos atribuídos, última posição, horário, precisão e idade do sinal. Marcador antigo deve aparecer como última posição conhecida, sem animação simulada ou interpolação apresentada como trajeto real. Um indicador de atividade do aplicativo não prova que localização está chegando. Mostrar separadamente recepção de posição, atividade/conexão e status de entrega.

Parâmetros iniciais para homologação, configuráveis: considerar amostra recente até 90 segundos; após isso indicar desatualizada; após cinco minutos indicar sem atualização. Avaliar precisão por limiar definido pela operação, com exibição do raio de incerteza. Ponto recebido agora, mas capturado há muito tempo, continua histórico, não posição ao vivo. Não usar ausência de sinal isoladamente para classificar desempenho.

Administrador da unidade acompanha as posições do expediente. Outros usuários precisam de direito explícito de monitorar entregas além do acesso à dashboard; quem só tem dashboard pode receber indicadores agregados sem acesso automático à posição individual. Entregador não vê localização de colegas. Cada unidade e sessão continuam isoladas.

## Contrato de envio e consumo de recursos

Usar watchPosition no cliente e limitar envio HTTPS: como ponto inicial de ajuste, no máximo uma atualização a cada 15–30 segundos em movimento; reduzir quando parado e nunca gerar posição nova por falta de amostra. Atualizar imediatamente o status de pausa/encerramento quando houver conexão. São metas de amostragem enquanto o PWA estiver executando, não garantias de frequência do sistema operacional.

Backend mantém somente a última posição por entregador/unidade, vinculada ao coletor e à sessão autenticada. Não há tabela, fila ou buffer de histórico de posições. Pausa, encerramento e logout do coletor apagam o ponto operacional. Evitar gravar um ponto por segundo, recalcular todas as rotas em cada movimento ou chamar serviço pago de mapas a cada posição. Alterar só o marcador não requer recalcular o trajeto. Manter cache de geocodificação/rotas conforme regras do fornecedor escolhido.

Autenticar como o próprio entregador; tenant/unidade/identidade vêm da sessão. Um único coletor ativo por entregador/unidade evita dois celulares sobrescrevendo posições. Outro navegador pode consultar as próprias entregas; assumir a coleta exige transferência explícita e revoga o identificador do coletor anterior. Dois navegadores do administrador podem acompanhar sem disputar a coleta. Sessão de trabalho não é caixa nem depende de token de terminal PDV.

Amostras têm sequência/idempotência, capturadoEm e recebidoEm do servidor, precisão e identificação do coletor. Validar limites geográficos numéricos, timestamps futuros/antigos, tamanho de lote e frequência; amostra atrasada não substitui uma mais recente. Dados enviados por software são declarações do dispositivo, não prova antifraude de localização. Logout do coletor/revogação de acesso impede novos envios; expiração/ausência de contato deixa a última posição desatualizada. Logout em um navegador de consulta não encerra outra sessão de trabalho autorizada.

O entregador envia posições por HTTPS; SSE pode avisar as dashboards autorizadas de mudanças e REST entrega o snapshot privado, com agrupamento de atualizações para evitar uma consulta por ponto. O tópico de entregas foi implementado no SSE existente, com aviso vazio e snapshot privado obtido por REST. Sem Redis/WebSocket novo nesta proposta. Sem rede, conclusão pode ficar pendente de sincronização com chave estável; não exibir como confirmada no servidor antes do aceite. Buffer de posições, se houver, é limitado e nunca mantém histórico indefinido no dispositivo.

## Validação adicional antes de habilitar localização

Testar Android e iPhone reais, navegador/PWA, bloqueio de tela, segundo plano, troca de aplicativo, permissão negada/revogada, localização aproximada, fonte indisponível, timeout, internet intermitente, relógio incorreto, bateria e recuperação. Testar mesma conta em dois aparelhos, transferência de coletor, mudança de unidade, logout, encerramento e tentativa de enviar posição fora do expediente. Verificar que concluir entrega é idempotente e não registra pagamento. Publicar como acompanhamento em uso ativo até evidência em dispositivos reais justificar afirmações mais amplas.

Referências técnicas consultadas em 30/10/2026:
- https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition — HTTPS, consentimento e acompanhamento de posição.
- https://www.w3.org/TR/geolocation/ — API agnóstica da fonte; posição/precisão não atestam GPS físico.
- https://developer.chrome.com/docs/web-platform/page-lifecycle-api — suspensão e descarte de páginas pelo navegador.
- https://developer.android.com/develop/sensors-and-location/location/background — requisitos e limitações específicos de localização nativa em segundo plano.


Conferência da implantação atual em 30/10/2026: gas.bansir.com.br respondeu HTTP200 por HTTPS e não enviou Permissions-Policy. Não foi observado bloqueio de geolocalização por esse header; isso não equivale a permissão concedida no aparelho. Na implementação, revisar política para a própria origem, CSP do provedor de mapas escolhido e testar permissões nos dispositivos. Nenhuma coordenada de cliente ou entregador foi solicitada durante esta preparação.
