# PDV: cliente, finalização e últimas vendas

Atualização preparada localmente, sem publicação na EC2 ou no S3.

## Publicação

Faça backup e aplique as migrações pendentes pelo migrador normal, incluindo `027_sale_customer_document.sql`. Essa migração libera somente a atualização da coluna de documento do consumidor; valores da venda permanecem imutáveis. Recrie a imagem e reinicie a API. Mantenha os workers fiscal, notificações e WhatsApp nas versões correspondentes às outras atualizações pendentes.

O ZIP `migration-private/bansir-gas-pdv-finalizacao.zip` contém o app compilado com a API de produção e inclui as melhorias anteriores. Publique seu conteúdo extraído na raiz do bucket do app, preservando acesso privado via CloudFront, e invalide o cache. Não publique código do backend ou arquivos de ambiente.

## Comportamento

- O botão `+` expande a identificação do cliente. Na identificação fiscal, CPF é o campo obrigatório. Nome é necessário para salvar um cadastro; entrega e venda a receber continuam exigindo os dados de contato necessários aos respectivos fluxos.
- `Finalizar venda` registra somente a venda e abre o recibo. `Finalizar venda e emitir nota` exige pagamento e CPF, registra a venda uma vez e abre a conferência fiscal dessa mesma venda. A intenção é preservada ao retomar uma solicitação pendente.
- A conferência fiscal ainda exige CFOP, NCM e tributação corretos. A aplicação não deduz tributação do gás pelo preço nem cria uma autorização fictícia. Se a conferência for cancelada ou falhar, a venda já registrada permanece no histórico para emissão posterior.
- O fluxo atual emite NFC-e (modelo 65). NF-e modelo 55 não foi implementada por esta alteração. O painel identifica o modelo do documento vinculado quando disponível.
- As últimas 10 vendas visíveis para o perfil aparecem abaixo do PDV. Ao selecionar, o painel mostra itens, pagamento, cliente, entregador e estado fiscal; permite receber saldo ou iniciar emissão conforme as permissões e o estado da venda.
- É possível informar/corrigir o CPF fiscal de uma venda paga sem nota antes de emitir. A alteração não modifica o cadastro do cliente nem o documento de outra venda. Depois de vincular documento fiscal, a API bloqueia essa alteração.
- Recibos podem ser abertos, baixados em PDF ou reimpressos. Para NFC-e autorizada, estão disponíveis XML, DANFE PDF e reimpressão via navegador/QZ. Downloads usam o documento autorizado existente; não criam nova emissão.
- A emissão continua dependendo do certificado A1, emitente, CSC, tributação e worker fiscal configurados e ativos. Esta atualização não habilita o worker fiscal de produção nem altera credenciais.

## Verificação

Build e CSS aprovados. Dez testes de integração PostgreSQL passaram, incluindo a migração, finalização com CPF, idempotência, isolamento e bloqueio de alteração após documento fiscal. Venda fictícia finalizada pelo navegador e detalhes conferidos em prévia local. Layout conferido em desktop e celular. Nenhuma nota foi enviada à SEFAZ e nenhuma impressão física foi executada durante a validação.
