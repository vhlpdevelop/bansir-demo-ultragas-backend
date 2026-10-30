# SSE de notificações

GET /api/v1/notifications/stream usa o mesmo contrato de cookies HttpOnly, identificação por aba e CSRF das outras rotas. O frontend usa fetch em streaming; não envia credenciais pela URL. Clientes Bearer continuam autenticados pelo contrato existente.

A tabela notifications continua sendo a fonte durável. Migração039 emite NOTIFY somente após commit, com IDs de roteamento, sem título/corpo/valores. Um único pg.Client dedicado por processo da API executa LISTEN, fora do pool usado pelas requisições. Conexões HTTP não reservam conexão ou transação PostgreSQL. O listener é iniciado sob demanda e encerrado no shutdown. Falha do listener encerra os streams, provocando reconexão/resincronização.

Eventos SSE ready e changed não contêm dados privados: apenas mandam consultar a caixa de entrada autenticada. Cada conexão guarda o usuário, unidade e sessão determinados pelo servidor. Antes de sinalizar uma alteração, a API revalida essa sessão no banco. Trigger de revogação encerra o canal daquela sessão; troca de senha que revoga todas encerra todos. A conexão também termina antes de expirar o access token ou em cinco minutos, o que ocorrer primeiro. Heartbeat de 20s mantém o proxy ativo, sem consulta ao banco. Cliente lento é desconectado ao atingir backpressure.

Duas sessões independentes da mesma conta/unidade recebem os mesmos avisos. Ler ou excluir um aviso modifica a caixa do usuário, portanto ambos os navegadores atualizam. Sair de um navegador não encerra a outra sessão. Outra unidade não recebe o sinal. Limites por processo: 500 streams totais e 12 por conta; exceder devolve 429/Retry-After e a interface usa consulta periódica. Os limites não são globais entre réplicas.

No frontend, abas ocultas suspendem o stream. Reconexão tem backoff de 1 a 60 segundos com jitter. Cada ready/foco recupera a lista atual; não há dependência de replay de NOTIFY. Consultas não se sobrepõem. Com stream conectado, desliga a consulta periódica; sem ele, consulta a cada 60s enquanto visível. Push continua para o aplicativo fechado. Não garante que o SO exiba um push.

Proxy: resposta inclui text/event-stream, no-store/no-transform e X-Accel-Buffering:no; heartbeats ficam abaixo do proxy_read_timeout atual de 60s. Usar HTTP/2 no acesso TLS evita o limite de conexões HTTP/1.1 por origem com muitas abas. Uma instalação sem stream funciona pelo fallback. Não é necessário Redis nem WebSocket nesta etapa.

Testes: duas sessões por cookies da mesma conta, outra unidade, uma única conexão LISTEN, ausência de conexão do pool ocupada por stream, criação/leitura/exclusão, rollback sem sinal, CSRF/origem, logout isolado e recuperação por ready. Teste frontend cobre frames divididos, heartbeat ignorado, aba oculta e reconexão. A API e o frontend completos precisam ser publicados; o frontend público não muda até upload no S3 e atualização de cache.
