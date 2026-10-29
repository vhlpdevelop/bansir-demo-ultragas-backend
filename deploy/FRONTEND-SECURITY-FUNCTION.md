# Headers pelo CloudFront Functions, mantendo o plano atual

A política customizada criada anteriormente não pode ser associada nos planos Free/Pro. Não fazer upgrade nem mudar para pay-as-you-go apenas para aplicar estes headers. A alternativa escolhida é uma CloudFront Function de viewer-response, disponível nos planos flat-rate atuais, conforme a [tabela oficial](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html).

## Aplicar

1. No console CloudFront → Functions, criar `bansir-gas-security-headers` com runtime **cloudfront-js-2.0**.
2. Copiar o conteúdo de `frontend-security-headers-function.js` para a função e salvar.
3. Na aba Test, selecionar evento **Viewer response** (não Viewer request). No editor JSON do evento de teste, colar o conteúdo completo de `frontend-security-headers-test-event.json`. Esse JSON pertence ao teste; o código JavaScript continua no editor de código da função. Caso o console apresente formulário visual, configurar Response status code 200 e os headers da resposta, ou alternar para o editor JSON. Executar Test function em DEVELOPMENT. O resultado deve preservar status 200 e incluir `x-content-type-options: nosniff`, `x-frame-options: DENY` e os headers CSP. A função foi validada localmente com esse evento; o teste local não substitui o teste AWS.
4. Publicar a função em **LIVE**.
5. Associar à distribuição cujo alias é exatamente **gas.bansir.com.br**, behavior padrão, evento **Viewer response**. Se já houver função nesse evento, integrar o código à função existente, preservando sua lógica; não substituí-la cegamente. Não alterar uma função compartilhada com outras distribuições sem avaliar seu uso.
6. Aguardar a atualização da distribuição. Conferir outros behaviors que atendem HTML/assets e associar a função onde necessário. Não alterar buckets, OAC, cache, certificados, plano ou CORS para isso.
7. Executar `node scripts/check-frontend-security-headers.mjs` e validar login, painel administrativo, pedidos, Meta, PWA, PDFs e QZ. Só considerar aplicado após verificar as URLs públicas.

A função adiciona nosniff, X-Frame-Options DENY, Referrer-Policy, CSP de base enforced e CSP completa em Report-Only. Preserva os demais headers. Não adiciona HSTS, não libera scripts com unsafe-eval e não transforma Report-Only em bloqueio de scripts. A CSP completa ainda exige validação antes de ser enforced.

O evento viewer-response não cobre todas as respostas de erro geradas pela AWS/origem; essa solução precisa ser verificada nos caminhos efetivamente servidos. Rollback: retirar a associação ou restaurar a versão anterior da função, preservando outras associações/lógicas existentes.

A policy `741b668b-5c16-4209-8e31-d89bf5508783` não é necessária para esta alternativa. Não é necessário apagar a pilha para testar a função. Nenhuma função foi criada ou associada remotamente nesta entrega: a role da EC2 não tem permissão CloudFront.

Se o teste retornar `TypeError: cannot get property "headers" of undefined`, faltou o objeto `response` no evento fornecido. Verificar o tipo Viewer response e usar o JSON completo de teste. Não resolver isso retornando o request sem adicionar os headers: a função precisa ser testada e associada no evento correto.

Referências: [teste de funções](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/test-function.html) e [estrutura de eventos](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-event-structure.html).
