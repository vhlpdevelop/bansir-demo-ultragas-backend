# Entregas e última localização — primeira versão

Implementado em 30/10/2026. Migrações PostgreSQL `040_delivery_operations.sql` e `041_delivery_contract.sql`.

## Operação

- Crie o acesso com cargo **Entregador**, trocando a senha temporária no primeiro login. Para funcionário, vincule esse usuário em **Funcionários**; o vínculo do entregador acompanha o funcionário. Freelancers continuam cadastrados separadamente: vincule o usuário na seção de equipe em **Distribuição de entregas**.
- Vendas com entrega, inclusive pedidos do link aceitos pela loja, entram na fila. O gestor confirma a distribuição. Endereço funciona sem coordenadas; o cliente pode enviar um ponto opcional, conferido e confirmado no checkout. A loja pode corrigir o destino operacional.
- A inicial separa pedidos ativos das **10 últimas entregas concluídas hoje**, com total diário e horário da loja (fuso do link de pedidos; padrão America/Cuiaba). **Histórico de entregas** consulta períodos e situações com 20 registros por página, sempre das próprias entregas.
- O entregador entra em **Minhas entregas**, inicia o compartilhamento voluntariamente e permite localização. Pode pausar, encerrar o expediente, abrir navegação, registrar saída, confirmar entrega ou informar tentativa sem sucesso. A conclusão NÃO recebe pagamento, baixa dívida ou movimenta caixa.
- Administrador acompanha os pedidos, a carga de cada entregador e sua última posição na distribuição/dashboard. Outras contas precisam de **Dashboard + Monitorar entregas** para posições individuais. Gestão de entregas sozinha não libera posições.
- Ordenação de candidatos: em expediente, menor carga atribuída e proximidade quando há ponto recente e preciso. Proximidade usa linha reta, explicitamente aproximada. Não calcula trajeto por ruas, sequência ótima de paradas, combustível ou economia real.
- Vendas antigas entram como **Anterior a conferir** e não contam como entregas realizadas. Só eventos novos confirmados alimentam o indicador de entregas concluídas nas últimas 24 horas. A fila limita a consulta a 200 entregas, priorizando as abertas.

## Somente a última posição

`driver_work` possui uma linha por entregador/unidade. Cada envio substitui latitude, longitude, precisão, horário da captura e horário de recebimento. Não existe histórico de coordenadas, amostragem em outra tabela ou buffer persistente de posições no navegador. `delivery_events` audita atribuição/status/motivo e digestos de requisições; não recebe coordenadas como payload histórico.

Pausar, encerrar e sair/revogar a sessão coletora limpam o ponto operacional no servidor. Sem rede, o navegador para imediatamente a coleta local; a confirmação da pausa é tentada ao reabrir o aplicativo, e o painel pode manter o último ponto como desatualizado até essa confirmação. A expiração/ausência de contato não inventa movimento: o horário permanece visível.

Envios no máximo a cada 20 segundos enquanto o PWA executa. Sequência e horário impedem amostras atrasadas de substituir uma captura mais recente. Servidor rejeita coordenadas inválidas, relógio/captura distante mais de dois minutos e coletor revogado; limita a 60 requisições por minuto/usuário/unidade. Até 90 s é recente, após isso desatualizada e após 5 min sem atualização recente; precisão acima de 100 m é insuficiente para a sugestão de proximidade.

Permissão negada, indisponível, timeout, segundo plano, pausa e fora de expediente são estados separados. Geolocalização pode vir de Wi-Fi/rede: não atesta GPS físico nem presença antifraude. Tela bloqueada, PWA fechado ou oculto pode suspender a coleta. Homologação em Android/iPhone reais ainda é necessária; acompanhamento contínuo em segundo plano exige projeto nativo específico.

## Acesso e concorrência

Tenant/unidade/usuário vêm da sessão autenticada, com CSRF nas sessões por cookie. RLS permanece obrigatório. Entregador só consulta e altera suas próprias entregas; não ganha acesso a produtos, caixa, financeiro ou localização de colegas. Destino não entra na configuração/status público da loja.

Um coletor ativo por entregador/unidade, vinculado à sessão de login. Outro aparelho exige transferência explícita; o anterior passa a ser rejeitado. Logout de outra sessão de consulta não interrompe o coletor atual. Vínculos duplicados de funcionários são rejeitados como ambíguos. Alterar vínculo freelancer encerra o compartilhamento anterior.

Atribuições e ações usam versão, lock e chave idempotente. Cancelar a venda cancela a entrega. Endereço e atribuição na entrega são operacionais: não reescrevem o snapshot fiscal/comercial da venda original.

SSE reaproveita o canal existente, com uma conexão LISTEN dedicada por processo da API, sem prender conexões do pool por navegador. Evento `delivery` contém apenas `{}`; dados vêm de REST autorizado. Sem Redis, WebSocket, novo worker ou envio automático de WhatsApp/push. Cliente reconecta e consulta a cada 60 s se o stream estiver indisponível.

## Contratos sob `/api/v1/deliveries`

| Método / caminho | Acesso / finalidade |
| --- | --- |
| GET `/snapshot?legacy=true` | Gestão: fila e equipe, posições somente com monitoramento |
| GET `/summary` | Dashboard: agregados; equipe/posição com monitoramento |
| GET `/accounts` | Gestão: usuários entregadores elegíveis da unidade |
| PUT `/drivers/:id/account` | Gestão: vincular freelancer; funcionário via Funcionários |
| GET `/mine` | Direito my-deliveries: identidade, expediente, tarefas ativas e últimas 10 concluídas hoje |
| GET `/mine/history?from=AAAA-MM-DD&to=AAAA-MM-DD&status=delivered&page=1` | Direito my-deliveries-history: histórico próprio paginado; datas opcionais; status delivered/failed/cancelled/all |
| POST `/work/start` | Entregador: collector UUID, transfer opcional explícito |
| POST `/work/stop` | Entregador coletor: pausa ou end=true para encerrar |
| POST `/work/status` | Entregador coletor: estado da coleta |
| POST `/work/position` | Entregador coletor: última posição, sequência e capturedAt |
| POST `/tasks/:saleId/assign` | Gestão: requestKey, version, driverId e motivo de reatribuição em rota |
| PATCH `/tasks/:saleId/destination` | Gestão: versão, endereço e ponto confirmado opcional |
| POST `/tasks/:saleId/actions` | Gestão ou entregador atribuído: depart, complete ou failed com motivo |

RBAC em Controle de acesso do estabelecimento: `deliveries-manage`, `my-deliveries`, `my-deliveries-history`, `delivery-monitor`. Operação e histórico próprio são direitos independentes; perfil Entregador preseleciona ambos ao cadastrar, e o gestor pode removê-los. A migração preserva os direitos das contas entregadoras existentes. Remover o direito de operar limpa a posição e encerra o compartilhamento. Administrador já possui gestão/monitoramento; `sales-manage` também libera a gestão, sem posição individual automática.

## Verificação e publicação

Testes com PostgreSQL descartável cobrem isolamento, RBAC, destino do link, idempotência, sequência/idade dos pontos, transferência entre sessões, logout, conclusão sem pagamento, SSE e regressões de caixa. Playwright usa contas e coordenadas fictícias, nunca dados de produção. Nenhuma assinatura ou fornecedor pago de mapas foi contratado.

API requer migrações 040 e 041 antes de recriar o serviço. Frontend: `npm run prepare:s3`; publicar TODO o conteúdo de `PUBLICAR-BANSIR-GAS`, com `assets/` preservado, assets antes de index e sem excluir assets antigos no bucket. API deve apontar para AWS. Só considerar o frontend publicado após validar URLs públicas e seus JS/CSS.

## Habilitar por empresa

No painel **Bansir → Empresas → Gerenciar → Funções contratadas**, a opção **Entregas e localização dos entregadores** controla `deliveries`. O bloqueio da API é imediato, inclui histórico/gestão/coleta e remove os pontos operacionais. Interfaces abertas sincronizam contrato e direitos em até 15 segundos quando visíveis; o stream também verifica o contrato antes de sinalizar entregas. Reabilitar não reinicia a coleta: o entregador deve ativá-la. Dados de entregas anteriores são preservados. A venda/checkout com entrega por endereço e o link de pedidos continuam sob seus controles independentes.

A opção inicia habilitada para empresas existentes para preservar o acesso atual. Para salvamento de contrato, a API exige as quatro chaves de funções; um painel antigo precisa ser atualizado antes de salvar. Nenhuma tabela de histórico de posições foi criada. Histórico de entregas é histórico operacional de pedidos, sem trajetos do entregador.
