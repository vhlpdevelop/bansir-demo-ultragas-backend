# Bansir Gás — revisão inicial de segurança

Data: 29/10/2026, America/Cuiaba. Backend local e EC2: `00fa045`; frontend local: `36e3305`. A versão do frontend publicada não foi equiparada byte a byte ao checkout local.

## Reparos após a revisão — 29/10/2026

### Estado mais recente — processamento de PDF e headers

**Atualização após associação pelo usuário:** verificação pública de 29/10/2026 confirmou `/` e `/bansir-admin` HTTP 200 com nosniff, X-Frame-Options DENY, Referrer-Policy, CSP de base com frame-ancestors none e CSP completa em Report-Only. JS `/assets/index-GCMPIe6V.js` e CSS referenciados responderam corretamente; API de saúde HTTP 200. O 503/FunctionExecutionError observado na associação anterior não apareceu nessa verificação. SEC-02 tem os headers de base observados em produção; a CSP de scripts permanece somente em observação, dependente de validação funcional Meta/QZ/PWA e futura promoção para enforced. A existência de headers não comprova ausência de XSS. O código `gas-spa`, fornecido pelo usuário, deve ser preservado em Viewer request; a função de headers usa Viewer response.

Atualização de custo/plano: o usuário confirmou bloqueio de policy customizada no plano atual. Preparada a alternativa `deploy/frontend-security-headers-function.js`, CloudFront Function viewer-response, com guia `deploy/FRONTEND-SECURITY-FUNCTION.md`. Sintaxe e preservação de headers de cache/CORS verificadas localmente; ainda não criada/associada na AWS. Não exigir upgrade para Business. SEC-02 permanece pendente de associação e validação pública.

- **SEC-04: contenção implementada e publicada**, código operacional `925a684272b449517e83b5c3f51f851296269acb`. Importações de clientes/produtos executam PDF.js em processo separado, com heap V8 de 192 MiB, prazo de 25 segundos, limites de texto/resultado, cancelamento por desconexão, uma leitura por empresa/usuário e uma global em produção. Excesso retorna 429 com Retry-After. O parser não herda credenciais de banco/AWS/JWT. O container API passou a ter 768 MiB, 1 CPU e 128 processos. O heap não limita sozinho todo o RSS; esta contenção não é um sandbox completo nem uma fila distribuída para várias réplicas. Ver `docs/PDF-RESOURCE-LIMITS.md` para escopo e riscos residuais.
- Validação: cinco testes de isolamento aprovados, incluindo CPU bloqueada com HTTP responsivo, timeout, crash, cancelamento e ausência de segredos; regressão de pedidos/importações/PDV/terminais aprovada (9 + 3 + 13 + 7 testes). Teste adicional da API confirmou 429/Retry-After em prévias concorrentes. Os relatórios completos privados de origem não estavam disponíveis nesta etapa; a extração foi validada com PDFs sintéticos dos testes.
- EC2 após deploy: API healthy, URL pública de saúde HTTP 200 com banco conectado, hashes dos três módulos de leitura/parse e Compose iguais ao commit; limites efetivos Memory=805306368, NanoCpus=1000000000 e PidsLimit=128. PDF técnico sintético de uma página lido dentro da imagem em 481 ms, `PDF_MAX_CONCURRENT=1`, sem URL administrativa no runtime. Backup prévio e imagem `before-pdf-isolation` preservados; nenhuma migração de banco foi necessária.
- **SEC-02: preparação concluída, aplicação AWS pendente.** A consulta CloudFront pela role da EC2 retornou HTTP 403/AccessDenied. Template `deploy/frontend-security-headers.cloudformation.json`, guia `deploy/FRONTEND-SECURITY-HEADERS.md` e verificador público preparados no commit `6ceb893`. Não se alterou a distribuição nem se ampliou a role da API. A policy propõe baseline enforced e CSP completa em Report-Only; não declarar proteção de scripts enforced. Registro de service worker saiu do HTML inline e foi para o bundle do frontend. A conferência pública final ainda encontrou os headers ausentes em `/` e `/bansir-admin`; ambas as páginas e os JS/CSS referenciados responderam HTTP 200. O HTML público referencia outro bundle, anterior ao pacote local final; publicação desse pacote não foi declarada concluída.
- Frontend `b752479`: cadastro/ativação/históricos somente em Configurações → Terminais; PDV com identificação e atalho compacto. Verificados navegação direta e layout mobile, console sem erros após recarga. Build completo regenerado em `PUBLICAR-BANSIR-GAS`, 18 arquivos conferidos com assets preservado e API AWS; upload e validação dessa versão pública continuam pendentes.
- **SEC-03, SEC-05 e SEC-06 permanecem pendentes.** A correção alta SEC-01 permanece aplicada; não foi confirmada nova SQL injection ou XSS executável nesta etapa.

### Histórico anterior — recibos e terminais

Atualização posterior: terminais do PDV implementados e publicados na EC2 no commit `84881c0b014a8a58e6c3e469dbbbb98f9a4f0c2f`, migração `035_pdv_terminals.sql`. O recibo mantém a verificação de autoria da SEC-01; teste adicional confirma negativa mesmo quando outro operador reutiliza exatamente o mesmo terminal. Cadastro administrativo, ativação única de navegador, origem imutável do caixa, exclusividade de caixa por terminal, revogação e recuperação administrativa auditada foram cobertos em PostgreSQL descartável (7 testes de terminais e 13 da suíte PDV aprovados). A identificação é do perfil do navegador, sem atestação física de hardware; detalhes em `docs/TERMINAIS-PDV.md`.

Verificação da EC2 após essa publicação: hashes dos quatro arquivos operacionais/migração conferem com o commit, API `healthy` e URL pública de saúde HTTP 200 com banco conectado; RLS habilitada e forçada em terminais; runtime pode inserir eventos de auditoria, sem UPDATE/DELETE; papel migrador novamente NOLOGIN e runtime sem DATABASE_ADMIN_URL. Preflight da origem do app aceita `X-Pdv-Terminal`. Nenhum terminal ou caixa real foi criado na verificação. Frontend commit `023f482`, pasta `PUBLICAR-BANSIR-GAS` atualizada e conferida pelo gerador; upload no S3 e validação pública dessa versão do frontend ainda pendentes.

- **SEC-01 corrigido e publicado na EC2**, commit `b44cd75a7ab17d47c496a44246a6ae4cd7d99f26`. A geração do recibo agora chama a mesma função `ownedSale` usada na consulta da venda, antes de gerar o PDF ou conceder autorização de impressão QZ. A política de autorização é compartilhada para evitar divergências futuras.
- Validação em PostgreSQL descartável: `npm run test:postgres -- test/pdv.integration.test.js`, **13 testes aprovados, nenhuma falha**. Inclui negativa para outro operador, usuário sem acesso ao módulo, outra unidade e outro tenant; acesso permitido ao autor, administrador e perfis com coleta/gestão; retirada de permissão tem efeito mesmo com JWT já emitido. As regras de pagamento, estoque e caixa da mesma suíte também passaram.
- Publicação com backup prévio e imagem anterior preservada para reversão. Sem migração de banco. Confirmados na EC2: revisão Git acima, hashes SHA-256 dos dois módulos alterados iguais aos arquivos do commit, container da API `healthy` e URL pública `https://api-gas.bansir.com.br/api/health` respondendo HTTP 200 com banco conectado. Não foram consultados recibos reais de clientes para essa verificação.
- Na primeira etapa, SEC-02 a SEC-06 ainda estavam pendentes. O estado atual está descrito acima. Os achados abaixo documentam a situação da revisão inicial, anterior aos reparos, sem certificar ausência de XSS/SQL injection.
- O frontend e a pasta `PUBLICAR-BANSIR-GAS` não foram alterados por este reparo; não é necessário upload no S3.

## Resumo executivo

Foram identificados **6 achados: 1 de severidade alta, 3 médios e 2 baixos**. O principal é uma inconsistência reproduzida de autorização: um operador impedido de consultar a venda de outro operador consegue obter o PDF do recibo dessa venda, dentro do mesmo estabelecimento, se conhecer seu UUID.

Não foi confirmada SQL injection nem execução de XSS nesta revisão. Consultas parametrizadas, validação com Zod, RLS e renderização React fornecem uma base útil. Isso não representa certificação de segurança nem prova de ausência de vulnerabilidades. Há lacunas de proteção no frontend, armazenamento de sessões e contenção de consumo de recursos.

Nenhum controle foi desativado, pacote atualizado, serviço reiniciado ou código operacional alterado durante esta revisão. Os testes ofensivos foram executados somente em PostgreSQL descartável, com dados sintéticos e container removido ao terminar. Em produção houve somente consultas de configuração e quatro requisições HTTP de leitura.

## Escopo e método

- API operacional Express/PostgreSQL em `src/postgres`, autenticação, painel de plataforma, catálogo/imagens, pedidos públicos, impressão, notificações e Bridge; revisão dos pontos mais relevantes das migrações de RLS e funções privilegiadas.
- Frontend React como consumidor da API, seus locais de armazenamento de sessão e padrões de renderização; pesquisa textual de sinks HTML/JavaScript perigosos no código próprio.
- Headers reais de `https://api-gas.bansir.com.br/api/health`, `https://gas.bansir.com.br/` e `/bansir-admin`; uma leitura adicional com Origin externo.
- Leitura de configuração não secreta da EC2: PostgreSQL selecionado, Node `v24.22.1`, `TRUST_PROXY_HOPS=1`, encaminhamento Nginx de `X-Forwarded-For` com `$remote_addr`, limites de recursos do container.
- `npm audit --omit=dev --json` nos lockfiles locais, sem instalar ou modificar dependências. O inventário de pacotes efetivamente instalado na imagem de produção não foi comparado integralmente.
- Provas locais em `migration-private/security-audit/security-boundaries.test.js`, com runner privado `migration-private/security-review-runner.js`. Os arquivos são ignorados pelo Git e não pertencem ao pacote frontend.

Não houve varredura de portas, carga concorrente, tentativa de senha, emissão fiscal, pagamento real ou envio de mensagens. WAF, Security Groups, políticas IAM completas, logs históricos, restauração de backups, dependências de desenvolvimento e cada rota legada não foram auditados integralmente.

## Achados

### SEC-01 — Alta — recibo não aplica a mesma autorização da venda

**Regra:** REACT-AUTHZ-001 / autorização por objeto no backend.

**Local:** [printing.js:41](/C:/Users/user/Desktop/projetos/Bansir/bansir-demo-ultragas-backend/src/postgres/printing.js:41), rota `GET /api/v1/sales/:id/receipt`; comparação com [sales.js:24](/C:/Users/user/Desktop/projetos/Bansir/bansir-demo-ultragas-backend/src/postgres/sales.js:24) e [sales.js:149](/C:/Users/user/Desktop/projetos/Bansir/bansir-demo-ultragas-backend/src/postgres/sales.js:149).

**Evidência:** a consulta de venda chama `ownedSale`, que verifica autoria ou permissões `sales-manage`/`sales-collect`. O recibo usa `scoped('sales',true,...)`, verifica apenas a existência da venda na unidade e chama `saleView`, sem essa verificação de autoria.

**Impacto:** um operador com acesso básico ao PDV pode obter informações de cliente, endereço, valores e pagamentos de uma venda de outro operador da mesma unidade que lhe está vedada na API de vendas.

**Reprodução confirmada:** com uma venda sintética criada por administrador e uma segunda conta com somente `sales`, a consulta da venda retornou **404** e o recibo retornou **200**, contendo PDF em base64. Nenhum UUID de cliente real foi usado. UUID aleatório reduz descoberta, mas não substitui autorização. Não foi demonstrado rompimento da barreira entre tenants/unidades.

**Correção proposta:** centralizar a política de leitura de venda em função compartilhada e aplicá-la antes de gerar recibos, PDFs e autorizações QZ. Manter exceções explícitas de administração/coleta. Testar autor, operador sem permissão, coletor autorizado e outra unidade.

**Critério de aceite:** operador sem permissão recebe a mesma negativa nos endpoints de venda e recibo; usuários autorizados continuam imprimindo normalmente.

### SEC-02 — Média — frontend publicado sem headers de proteção

**Regra:** EXPRESS-HEADERS-001 / REACT-CSP-001 / REACT-HEADERS-001.

**Local:** [public/_headers:1](/C:/Users/user/Desktop/projetos/Bansir/bansir-demo-ultragas-app/public/_headers:1), shell HTML servido em `/` e `/bansir-admin`.

**Evidência em produção:** ambos retornaram HTTP 200 sem `Content-Security-Policy`, `Content-Security-Policy-Report-Only`, `X-Frame-Options`, `X-Content-Type-Options` e `Referrer-Policy`. A API possui CSP/headers do Helmet, mas esses headers não protegem o documento HTML servido por S3/CloudFront. O arquivo `_headers` contém apenas regras de cache; enviá-lo ao S3 não configura headers HTTP no CloudFront.

**Impacto:** falta uma camada de contenção de XSS e proteção explícita contra enquadramento/clickjacking, inclusive para o painel administrativo. Não foi demonstrado XSS executável ou uma transação induzida por iframe.

**Correção proposta:** configurar Response Headers Policy na distribuição correta do app; começar CSP em Report-Only, inventariar scripts inline, Meta, fontes, PDFs/blobs e QZ Tray. Externalizar ou usar hashes para scripts inline antes da política restritiva. Aplicar política de enquadramento após confirmar se há algum embedding legítimo. Não liberar genericamente `unsafe-eval` nem scripts inline só para eliminar erros.

**Critério de aceite:** headers presentes nas duas URLs públicas; testes de login, seleção de unidade, Meta, impressão, pedidos e service worker sem regressão. CSP é defesa adicional, não substitui escape/validação.

### SEC-03 — Média — tokens acessíveis ao JavaScript da página

**Regra:** REACT-AUTH-001 / JS-STORAGE-001.

**Local:** [authSession.js:9](/C:/Users/user/Desktop/projetos/Bansir/bansir-demo-ultragas-app/src/services/authSession.js:9), [PlatformAdminPage.jsx:14](/C:/Users/user/Desktop/projetos/Bansir/bansir-demo-ultragas-app/src/pages/PlatformAdminPage.jsx:14).

**Evidência:** access e refresh tokens PostgreSQL ficam no `sessionStorage`; a sessão do painel Bansir também. O modo legado usa `localStorage`. Sessões administrativas são opacas e revogáveis, mas continuam legíveis por scripts executando na origem.

**Impacto condicional:** se houver XSS ou comprometimento de script com acesso à origem, ele pode ler sessões; a exposição da conta de plataforma tem alcance em vários tenants. Armazenar por aba não fornece a proteção de `HttpOnly`. Não foi demonstrado roubo de sessão nesta revisão.

**Correção proposta:** planejar refresh/admin em cookies `HttpOnly`/`Secure`, mantendo access token curto em memória se apropriado, ou adotar uma camada BFF. Antes dessa migração, desenhar CORS com credenciais, escopo de cookies, validação de Origin e proteção CSRF. Preservar sessão absoluta, rotação e revogação. Não converter para cookie sem CSRF.

**Mitigação intermediária:** corrigir SEC-02, reduzir scripts de terceiros, reforçar a conta administrativa com MFA e exigir reautenticação em ações sensíveis.

### SEC-04 — Média — contenção de CPU/memória insuficiente para tarefas de arquivos

**Regra:** EXPRESS-DOS-001 / EXPRESS-BODY-001.

**Local:** [pdf-import.js:6](/C:/Users/user/Desktop/projetos/Bansir/bansir-demo-ultragas-backend/src/postgres/pdf-import.js:6), [app.js:47](/C:/Users/user/Desktop/projetos/Bansir/bansir-demo-ultragas-backend/src/postgres/app.js:47), [compose.production.yml:2](/C:/Users/user/Desktop/projetos/Bansir/bansir-demo-ultragas-backend/compose.production.yml:2).

**Evidência:** limites de upload e número de páginas existem, e PDF.js está com avaliação de código desabilitada. Porém o processamento de PDF ocorre no processo da API, sem orçamento explícito de tempo ou fila de concorrência por usuário/tenant. Na EC2, o container da API apresentou `Memory=0`, `NanoCpus=0` e `PidsLimit=null` — sem limites explícitos nesses campos. Nginx limita corpo a 8 MB; nos trechos inspecionados não apareceu `limit_req`.

**Impacto potencial:** solicitações válidas de usuários autorizados com arquivos complexos ou concorrência podem disputar recursos com vendas e login. Não foi feito teste de exaustão nem demonstrada indisponibilidade.

**Correção proposta:** separar importação pesada em worker com limite de memória/tempo; limitar operações simultâneas por usuário e tenant; estabelecer quotas para uploads e geração de PDFs; definir limites do container considerando a RAM do host e os workers. Acrescentar métricas e limites de borda sem bloquear os caixas legítimos de uma mesma rede.

**Critério de aceite:** arquivo complexo ou timeout cancela só a tarefa; API de saúde e vendas continuam atendendo em teste de carga controlado fora de produção.

### SEC-05 — Baixa — imagem validada apenas por prefixo, sem decodificação

**Regra:** EXPRESS-UPLOAD-001 / REACT-FILE-001.

**Local:** [product-images.js:11](/C:/Users/user/Desktop/projetos/Bansir/bansir-demo-ultragas-backend/src/postgres/product-images.js:11).

**Reprodução confirmada:** `imageType` aceitou bytes de assinatura PNG seguidos de conteúdo que não constitui uma imagem válida. A função reconhece os primeiros bytes de PNG/JPEG/WebP, mas não verifica estrutura, dimensões ou decodificação completa.

**Impacto:** armazenamento de conteúdo inválido, imagens quebradas e retenção de metadados desnecessários. Isso **não demonstra XSS**: a entrega usa MIME de imagem e `nosniff`, e a exibição usa `<img>`. O limite de 2 MB, RBAC e o bucket privado são controles positivos.

**Correção proposta:** decodificar e reencodar com biblioteca mantida, limitar dimensões/quantidade de pixels e remover EXIF; manter rejeição de SVG/HTML e nomes/chaves gerados pelo servidor. Revisar retenção de objetos substituídos/órfãos como controle de custo.

**Critério de aceite:** arquivo de assinatura forjada é rejeitado antes de gravar; imagens reais continuam aceitas dentro dos limites.

### SEC-06 — Baixa — aviso de dependência transitiva na cadeia fiscal

**Regra:** EXPRESS-DEPS-001 / REACT-SUPPLY-001.

**Local:** `package-lock.json`, cadeia NFeWizard; versão local instalada `deepmerge@4.3.1`.

**Evidência:** `npm audit --omit=dev` identificou **7 pacotes classificados como baixos no backend**, ligados à cadeia de dependências afetada. Isso não significa sete vulnerabilidades independentes: o aviso raiz observado é [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), sobre alteração do protótipo do objeto retornado por `mergeObject`. O advisory consultado não informa versão corrigida. No frontend, o mesmo comando não identificou vulnerabilidades nas dependências de produção.

**Impacto condicional:** depende de dados controlados pelo usuário alcançarem um merge vulnerável e de uso inseguro do objeto resultante. Essa cadeia de exploração não foi comprovada na API. Não se deve apresentar o resultado do npm como prova de RCE ou XSS.

**Correção proposta:** verificar alcançabilidade na biblioteca fiscal, reforçar schemas dos objetos livres e acompanhar upstream. Não executar `npm audit fix --force`: a sugestão observada inclui downgrade incompatível de NFeWizard, com risco funcional/fiscal. Substituição/patch só com testes fiscais e de regressão.

## Controles positivos observados

- Consultas PostgreSQL com parâmetros; nomes de colunas dinâmicos vêm de mapas fixos e schemas. A busca por apóstrofo/expressão SQL, em teste isolado usando o parâmetro correto `q`, foi tratada como texto e retornou zero resultados. Isso valida apenas esse caminho.
- Contexto de usuário/tenant/unidade por transação, RLS forçada e verificação de associação/sessão. A inicialização rejeita papel de banco com propriedade de tabelas, superusuário ou bypass de RLS.
- JWT com algoritmo/audience/issuer explícitos; access token curto, refresh rotativo com hash e validade absoluta; troca de senha revoga sessões e seleções pendentes; bcrypt com custo 12.
- CORS com allowlist. Uma Origin externa não recebeu `Access-Control-Allow-Origin`. HTTP 200 nessa leitura pública de health não é bypass de CORS nem falha de autenticação.
- `trust proxy` da produção em um salto e Nginx sobrescrevendo `X-Forwarded-For` com o endereço remoto, coerentes com a topologia observada.
- Webhook Meta verifica HMAC sobre corpo bruto; XML fiscal rejeita DTD/entidades declaradas; PDF.js usa `isEvalSupported:false`; assinaturas QZ têm allowlist de comandos e liberação contextual de documentos.
- Não foram encontrados, pela busca textual no código próprio de `src/postgres` e `app/src`, usos de `dangerouslySetInnerHTML`, `.innerHTML`, `document.write`, `eval` ou `new Function`. Isso não cobre toda a semântica das dependências.
- API com Helmet, erros externos genéricos, limites de corpo e rate limit. Container não root, filesystem somente leitura e capabilities removidas. Arquivos privados e envs excluídos do contexto Docker.

## Estratégia de defesa proposta

| Ordem | Trabalho concreto | Validação para concluir |
|---|---|---|
| 1 | Corrigir SEC-01 em política compartilhada de acesso a vendas/recibos | Matriz de testes autor, outro operador, coletor, admin e outra unidade |
| 2 | Configurar headers no CloudFront do app e CSP Report-Only; inventariar dependências de origem | Verificar headers públicos, console e fluxos de Meta/QZ/login em homologação |
| 3 | Fortalecer administração: MFA, reautenticação, limitação adicional por identidade e logs de falha sem segredos | Testar credenciais inválidas, recuperação e revogação sem travar contas legítimas |
| 4 | Planejar migração de sessões para HttpOnly/BFF com CSRF; não misturar modelos de autenticação sem desenho | Testar refresh concorrente, logout, troca de unidade e tentativa de CSRF |
| 5 | Isolar processamento pesado, quotas e limites por tenant; validar imagens por decodificação | Teste de carga controlado e corpus de arquivos inválidos fora de produção |
| 6 | Incorporar testes de segurança e dependências ao CI; revisar funções SECURITY DEFINER e observabilidade | Pipeline detecta regressões de autorização/injeção e acompanha advisories |

WAF pode complementar esses controles após observar tráfego legítimo; não deve substituir consultas parametrizadas, autorização ou correções de código. Priorizar regras inicialmente em modo de contagem e avaliar custos e falsos positivos. Não se propõe bloquear palavras como “SELECT” ou remover todos os caracteres especiais: isso quebra dados legítimos e não elimina a causa de SQL injection/XSS.

**Observabilidade:** o app permite `onError`, mas a inicialização atual não fornece esse callback. Nginx pode registrar requisições, porém não equivale a auditoria de falhas de login e mudanças de permissão. Incluir IDs de requisição, tenant/unidade quando autenticados, categoria da negativa e alerta; excluir senhas, Bearer tokens, chaves e conteúdo pessoal desnecessário. MFA e logging constam como melhorias de estratégia, não como bypasses reproduzidos.

## Fontes primárias

- [OWASP — SQL Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)
- [OWASP — XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
- [OWASP — Content Security Policy](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
- [OWASP — File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [Express — Production Security](https://expressjs.com/en/advanced/best-practice-security/)
- [GitHub Advisory — deepmerge](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)

## Próxima decisão

A recomendação da revisão inicial foi começar por SEC-01, posteriormente corrigida e publicada. SEC-04 recebeu contenção de importação em processo separado com limites, publicada na etapa mais recente. SEC-02 tem template e preparação do frontend, mas depende de aplicação/verificação na distribuição correta do CloudFront. SEC-03, SEC-05 e SEC-06 continuam no plano de reparos. A revisão original foi somente diagnóstico, anterior às publicações registradas acima.

## Atualização mais recente — 29/10/2026 — rate limiting e cookies

Backend 92a1489 publicado na EC2; frontend 5187a47 preparado para upload manual no S3. Sem MFA conforme pedido. Migração 036: limites persistentes por conta/IP (loja 10/60, painel 5/20 em 15 minutos), HMAC para chaves, IPv6 /56, Retry-After e janela que não se estende ao bloquear. Sucesso limpa somente conta. Runtime não lê/escreve tabela; executa função de escopo fixo.

SEC-03 parcialmente mitigada: novo frontend usa cookies Secure/HttpOnly/SameSite Strict para refresh operacional e sessão opaca administrativa, Origin explícito e provas CSRF vinculadas. Loja conserva access token de 10 minutos em sessionStorage por aba; não declarar XSS resolvido ou sessão operacional integralmente fora do JavaScript. Cookies distintos por jti preservam unidade; legado/APK continuam compatíveis. Painel novo não armazena token no JavaScript. Aplicação web depende de publicar o pacote completo PUBLICAR-BANSIR-GAS no bucket do app.

Testes locais backend, frontend e navegador real aprovados com dados descartáveis, incluindo duas unidades, renovação concorrente, CSRF, origens, revogação e persistência do bloqueio após recriar app. EC2: API healthy, saúde pública 200, hashes conferidos, migrador NOLOGIN e sem URL administrativa no runtime. CORS preflight público com credenciais 204; origem externa 403. Nenhuma conta real usada para testar limites. SEC-05, SEC-06 e promoção da CSP completa continuam pendentes. Detalhes em docs/BROWSER-SESSIONS-RATE-LIMIT.md. Este bloco posterior prevalece sobre os estados históricos acima.

Atualização 30/10: backend adf266b e frontend a14063f implementam access e refresh HttpOnly no modo web completo, com CSRF em todas as rotas protegidas e migração da sessão anterior ao restaurar a aba. Testes de API e navegador aprovados (login, GET, refresh, reload, logout). APK preservado. Publicação do frontend completo no S3 continua pendente, portanto não declarar migração ativa para todo o público; compatibilidade com clientes anteriores permanece. Não equivale à resolução de XSS em execução na mesma origem.
