# Sessão renovável e localização no link

Migração 015 adiciona apenas o hash do refresh token às sessões existentes. Novos logins e seleções emitem access token de 10 minutos (padrão) e refresh token com prazo absoluto de 12 horas. Renovar não estende esse limite. Sessões antigas continuam com sua validade anterior e recebem o recurso no próximo login.

Refresh é rotacionado sob bloqueio da sessão e senha; reutilizar um token anterior revoga a família inteira, inclusive access tokens ainda dentro da validade. Usuário, empresa, estabelecimento e participação são revalidados. Logout online, retorno à seleção e alteração da senha revogam a sessão/família; senha revoga todas as sessões do usuário. O refresh não permite escolher outra unidade. API: POST /auth/refresh e POST /auth/logout.

Tokens permanecem em sessionStorage por aba, preservando a seleção fixa; refresh não é cookie HttpOnly. O banco armazena SHA256 do token, não o token bruto. O cliente concentra requisições simultâneas de refresh, renova antes de chamadas próximas da expiração e ao verificar token expirado. Falhas de rede não apagam o refresh. Renovação concluída depois de logout ou nova seleção não restaura a sessão anterior. Fechar a aba normalmente descarta o armazenamento local; sem comunicação de logout, o registro do servidor expira no prazo absoluto. Abas duplicadas que clonem a mesma credencial podem revogar a família ao tentar rotacionar tokens antigos; fazer login próprio em cada aba.

O período é absoluto, não um timeout por inatividade. Ao completar 12 horas, novo login é necessário. Nenhuma senha real de cliente foi usada nos testes.

## Localização

Página de pedidos → Localização da loja: endereço público, latitude/longitude opcionais e prévia do mapa. Coordenadas são validadas e exigidas juntas; a prévia exige coordenadas. O botão Como chegar abre Google Maps em nova aba. A prévia é pequena e recolhida, inclusive no celular, abrindo sob demanda. Nenhum endereço real foi inventado ou alterado automaticamente. O mapa depende do serviço Google e de acesso à internet.

Texto público alterado para Gás e água para sua casa. Fazer meu pedido rola suavemente até o celular ou catálogo, respeitando a preferência de movimento reduzido.

## Validação

Testes PostgreSQL de rotação, limite absoluto, replay, logout, seleção e senha, mais regressões de autenticação, pedidos e isolamento. Testes de armazenamento por aba aprovados. No navegador com conta fictícia, expiração simulada e duas requisições concorrentes renovaram o token mantendo a unidade. Layout do link e localização conferidos no celular, sem erros de console. Build e CSS aprovados.

Deploy: backup, aplicar 015 com o migrador e recriar API. Publicar o conteúdo do ZIP do app no bucket e invalidar /* no CloudFront. A chave JWT existente é preservada.
