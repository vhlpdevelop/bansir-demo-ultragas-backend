# Sessões do navegador e limites de login

Sem MFA nesta etapa. Migração 036 adiciona janelas de autenticação persistentes no PostgreSQL. Não remove nem altera sessões, caixas, usuários ou terminais existentes.

## Limites

Janela fixa de 15 minutos: login da loja, 10 tentativas por conta e 60 por IP; painel Bansir, 5 por conta e 20 por IP. Conta é normalizada por e-mail; IPv6 é agrupado por /56. Contadores compartilham o banco, sobrevivem a reinício e valem entre réplicas. Sucesso limpa apenas o contador da conta; o orçamento por IP inclui sucessos. Tentativas bloqueadas não prolongam a janela. Resposta 429 informa Retry-After. IP e e-mail são persistidos somente como HMAC-SHA256 com chave do servidor. A função tem search_path fixo e a tabela não permite leitura/escrita pelo runtime. Limites Express existentes continuam como contenção adicional por processo; configure TRUST_PROXY_HOPS somente conforme o proxy real.

## Contrato web

O frontend envia `X-Bansir-Client: browser`, `credentials: include` e Origin permitido nas rotas de autenticação. Produção exige HTTPS; cookies `__Host-bansir-*` são Secure, HttpOnly, SameSite=Strict, Path=/ e sem Domain. API e app atuais são HTTPS no mesmo site bansir.com.br. CORS continua com lista explícita; nunca usar origem coringa com credenciais. Respostas de autenticação e painel usam Cache-Control: no-store.

Loja: access token continua por aba, com validade de 10 minutos e autenticação Bearer. Refresh de 12 horas absolutas passa a cookie HttpOnly separado por ID da sessão, sem retornar o segredo no JSON. `cookieSession` contém apenas ID, validade e prova CSRF; fica no sessionStorage da aba. Renovação usa X-Bansir-Session e X-CSRF-Token. A API valida Origin, prova HMAC ligada à sessão, cookie correspondente, assinatura JWT, hash rotativo e vínculos no banco. Cookies compartilhados pelo navegador não trocam a unidade selecionada. Web Locks serializa a rotação em abas duplicadas quando disponível. Logout, retorno à seleção e senha mantêm revogação no servidor e removem o cookie atual.

Painel: cookie independente com sessão opaca de duas horas, sem token no armazenamento JavaScript. GET /platform/csrf restaura usuário e prova CSRF após validar o cookie no banco. Toda mutação exige a prova e Origin permitido. Login do painel substitui seu cookie entre abas; não afeta sessões das lojas. Alteração de senha revoga todas as sessões administrativas.

Clientes antigos e APK sem o header browser preservam Bearer e refresh explícito em JSON; não autenticam por cookies implicitamente. Uma renovação com refresh legado e header browser migra a sessão web para cookie sem deslogar. Publicar API antes do frontend. Novo frontend remove o token administrativo antigo do sessionStorage e exige um novo login no painel.

HttpOnly impede leitura do refresh e da credencial administrativa por JavaScript, mas não impede ações de um XSS no próprio app. Access token operacional ainda está no JavaScript por aba; migrar toda autenticação da loja para cookie exige um contrato adicional de seleção por aba e proteção de todas as mutações. CSP completa ainda está em Report-Only. Não declarar SEC-03 totalmente resolvida.

## Publicação e validação

Backup e migração 036 com migrador temporário, devolver NOLOGIN; recriar API sem DATABASE_ADMIN_URL. Preservar JWT_SECRET, lista CORS e proxy de confiança. Conferir saúde pública e preflight com credenciais. Frontend: npm run prepare:s3 entrega a pasta PUBLICAR-BANSIR-GAS completa com assets/ preservado e URL API AWS. Publicar assets antes de index.html, manter assets antigos no S3 e invalidar CloudFront. Não declarar frontend publicado antes de verificar URLs e navegador.

Testes em PostgreSQL descartável cobrem cookies, HTTPS, CSRF, origens, rotação, separação entre unidades, revogação, compatibilidade nativa, migração de sessão legada, restauração do painel e limites persistentes. Nenhuma conta real é usada para testar bloqueios.

## Atualiza��o 30/10/2026: autentica��o operacional integral por cookies

Novo frontend envia X-Bansir-Session-Mode: cookie. Nesse modo, access e refresh ficam apenas em cookies HttpOnly por jti; JSON n�o retorna nenhum dos dois. sessionStorage cont�m ID, escopo para escolher v�nculo local, validade e prova CSRF, sem JWT de acesso/refresh. Toda opera��o protegida, inclusive leituras, uploads e downloads, exige origem (ou Referer permitido em GET/HEAD) e prova CSRF. A API ignora Bearer fornecido pelo cliente nesse modo, valida o JWT do cookie de acesso e revalida sess�o/v�nculos no banco como antes. Respostas privadas web usam no-store. Logout limpa ambos os cookies. A interface usa marcador local sem poder de autentica��o, renova antes de expirar e mant�m sele��o por aba.

Clientes web anteriores sem o novo header conservam contrato antigo durante a publica��o; APK permanece Bearer expl�cito. No novo frontend, sess�o anterior migra por refresh ao restaurar a aba. Esta atualiza��o substitui os trechos hist�ricos acima sobre access token operacional em sessionStorage. Cookies n�o impedem a��es de um XSS ativo na mesma origem; CSP e demais corre��es seguem relevantes. Publicar frontend completo para ativar o novo modo no navegador.
