# Headers de segurança do app de Gás — SEC-02

O app usa o bucket privado `bansir-gas-app-prod-1` e o domínio `gas.bansir.com.br`. O arquivo `_headers` dentro do S3 não configura os headers HTTP do CloudFront. A API já possui Helmet, mas seus headers não se aplicam ao HTML do frontend.

## Estado desta entrega

Template pronto: `frontend-security-headers.cloudformation.json`. **Ainda não aplicado.** A consulta ao CloudFront com a role da EC2 retornou HTTP 403 / `AccessDenied` em 29/10/2026. Não ampliar a role de execução da API para administrar a CDN; usar uma conta/perfil de infraestrutura autorizado. Nenhuma distribuição foi alterada e o achado SEC-02 continua pendente de aplicação/verificação pública.

## Aplicar com uma conta de infraestrutura

1. No CloudFormation, criar a pilha `bansir-gas-app-security-headers` usando este template. Pode usar us-east-1 para manter os recursos globais organizados. Não fornecer a role da EC2 como role de execução da pilha. O template cria somente uma Response Headers Policy, sem bucket nem distribuição.
2. Anotar a saída `ResponseHeadersPolicyId`.
3. No CloudFront, identificar a distribuição cujo domínio alternativo é **exatamente `gas.bansir.com.br`** e cuja origem aponta ao bucket do app. Não selecionar a distribuição do site institucional `bansir.com.br`, da área fiscal ou outro SaaS.
4. Salvar a configuração anterior e o ID da policy de cada behavior. CloudFront aceita uma Response Headers Policy por behavior; se já houver uma, preservar suas regras necessárias ao incorporar os novos headers. Não remover CORS ou headers existentes sem avaliar o uso.
5. Associar a policy aos behaviors que atendem o HTML e os assets do app, incluindo o behavior padrão usado no fallback SPA de `/bansir-admin`. Não mudar origens, OAC, permissões do S3, métodos HTTP, certificados ou regras de cache para aplicar estes headers.
6. Aguardar a distribuição ficar Deployed. Publicar separadamente a pasta completa do frontend pelo fluxo normal: assets antes de index, estrutura Vite intacta e assets antigos preservados no S3. Invalidar o cache de HTML/SW necessário ao publicar o build. Não habilitar acesso público ao bucket.
7. Executar `node scripts/check-frontend-security-headers.mjs` no backend e testar os fluxos abaixo. Só declarar o achado resolvido após validar as URLs públicas e a funcionalidade.

## O que a policy faz

- Aplica `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, Referrer-Policy e uma CSP de base com `base-uri 'self'`, `object-src 'none'` e `frame-ancestors 'none'`.
- A CSP completa de scripts/conexões fica inicialmente em **Report-Only**. Ela aponta violações no console e não bloqueia scripts de login/Meta/QZ antes de verificar os usos reais. Não há coletor remoto de relatórios nesta entrega; não prometer telemetria centralizada.
- O registro de service worker foi movido do script inline de `index.html` para o bundle Vite, preparando a adoção de `script-src` sem scripts inline.
- Não habilita `unsafe-eval`. O `unsafe-inline` de **estilos** no candidato é necessário pelos estilos inline React atuais; não autoriza scripts inline. Não implementar uma política genérica que libere qualquer script só para silenciar avisos.
- Não muda HSTS, cookies, CORS da API nem permissões de câmera/USB/Bluetooth. Esses recursos precisam continuar disponíveis aos seus fluxos específicos.

## Inventário e validação

Origens visíveis no código: API `api-gas.bansir.com.br`, SDK Meta `connect.facebook.net`, login/frames Meta, Google Fonts, imagens/QR em data/blob, PDFs em blob e QZ Tray em loopback. Os patterns de loopback do candidato Report-Only devem ser reduzidos às conexões reais depois da verificação; não são aprovação de serviço HTTP público.

Validar em `/` e `/bansir-admin`: login/logout, seleção de estabelecimento, troca de senha, registro/atualização de PWA, catálogo e imagens públicas, link de pedidos, checkout, certificado/NFC-e, PDF de recibo/DANFE e QZ. Verificar Meta Embedded Signup com uma conta autorizada, sem remover números existentes. Testes locais ou no emulador não provam compatibilidade real de Meta ou QZ.

Inspecionar violações de CSP no navegador com a policy aplicada, conferir cada origem pelo código e reduzir as exceções. Promover as diretivas de scripts para CSP **enforced** somente após essas verificações, em alteração separada. Uma policy em Report-Only sozinha não impede execução de XSS.

Rollback: reassociar os IDs de policies anteriores aos mesmos behaviors. Preservar o bucket privado e a estrutura dos assets; não apagar arquivos para reverter headers.

Referências oficiais: [criar e associar uma policy](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/creating-response-headers-policies.html) e [funcionamento das response headers policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/understanding-response-headers-policies.html).
