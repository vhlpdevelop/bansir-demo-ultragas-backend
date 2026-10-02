# Notificações push

## Configuração

Na pasta do backend, execute `npm run push:keys`. O comando gera uma única vez
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` no `.env`, ignorado pelo
Git e pelo Docker. Execuções posteriores preservam as chaves existentes.
O frontend obtém apenas a chave pública por `/api/v1/notifications/vapid-public-key`.
A chave privada fica exclusivamente no backend. Ajuste `VAPID_SUBJECT` para um
contato administrado por você.

Para a demo no Render, cadastre os mesmos três valores do `.env` nas variáveis
de ambiente do serviço backend e reinicie/republique o serviço. Publique também
as alterações do frontend. Não coloque a chave privada em variáveis `VITE_*`.
Não gere novas chaves a cada deploy: assinaturas estão associadas à chave usada
na criação. As antigas chaves fixas foram substituídas; abra o app e ative as
notificações novamente para renovar a assinatura.

## Validação no navegador

1. Abra o frontend em HTTPS ou localhost e entre com uma conta autenticada pela API.
2. No convite de notificações, clique em ativar e conceda a permissão do navegador.
   O app só confirma a ativação após criar e salvar a PushSubscription no backend.
3. Abra Dispositivos Conectados & Push e clique em Enviar Teste. O teste envia
   apenas aos aparelhos da conta atual. A contagem indica aceitação pelo provedor,
   não confirmação de leitura ou exibição pelo sistema operacional.
4. Com o app em segundo plano, conclua uma venda ou crie uma notificação com uma
   conta autorizada. Os destinatários seguem as regras de perfil e preferências.
5. Silencie um aparelho e recarregue: a sincronização deve preservar o silêncio.

O botão para ativar o aparelho atual também solicita a assinatura. Um aparelho
remoto sem assinatura precisa ser ativado no próprio navegador. Bloqueio de
permissão, navegador incompatível e falha de registro são exibidos como erro.

Dispositivos e assinaturas são persistidos nos usuários do MongoDB. Histórico de notificações e marcações de leitura também são persistidos. Não existe modo em memória sem banco.

## Verificação automatizada

- Backend: `npm test` (usa chaves efêmeras, HTTP local e mocks de transporte/MongoDB;
  não envia notificações externas nem acessa um banco real).
- Integração no Atlas isolado: `npm run test:mongo` (veja [SEED.md](SEED.md)).
- Frontend: `node --test test/push.test.js` e `npm run build`.

Há cobertura de criptografia Web Push, registro autenticado, CORS, preferências,
isolamento do teste por conta, transferência de endpoint em computadores
compartilhados, renovação VAPID e remoção persistente em respostas 404/410.
Envios têm timeout de 10 segundos e TTL de uma hora. Falhas não desfazem vendas;
não há fila persistente ou retentativa automática de envio neste fluxo.
