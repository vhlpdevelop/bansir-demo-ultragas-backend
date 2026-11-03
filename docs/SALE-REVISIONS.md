# Revisão de venda finalizada

Administradores e perfis com `sales-manage` podem abrir **Editar venda** nos detalhes do cupom. A operação funciona após o fechamento do caixa, pois não altera valores financeiros.

Campos: nome/documento/contato do cliente, endereço do recibo, observações, endereço fiscal e perfis fiscais de cada item. Dados fiscais exigem também permissão `fiscal`. O motivo é obrigatório e o histórico registra usuário, horário, versão e dados anteriores/posteriores. Cadastro do cliente, catálogo, vínculo de convênio, produtos, quantidades, valores, pagamentos, estoque e caixa de origem são preservados.

**Fiscal dos itens → Carregar fiscal atual do catálogo** copia a configuração para conferência. Escolher NF-e 55 ou NFC-e 65 e salvar a revisão permite corrigir a tributação congelada de um cupom antigo antes da emissão. Essa ação não emite notas. A atualização do catálogo sozinha continua sem reescrever vendas anteriores.

Venda cancelada, documento fiscal vinculado, reserva de lote ou cobrança SmartPOS pendente bloqueiam a edição. Endereço operacional de pedido/entrega vinculado exige o fluxo próprio de entrega; o endereço fiscal pode ser revisto separadamente. Alterar uma nota já emitida exige o fluxo fiscal adequado.

API: `GET /sales/:id/edit` e `PATCH /sales/:id/edit`. O PATCH recebe UUID de tentativa, versão esperada, motivo e campos explícitos. A migração 060 cria auditoria com RLS e libera apenas as colunas necessárias. Repetição da mesma tentativa não cria outra revisão; conflito de versão não sobrescreve outra alteração.

Tributação PIS/COFINS CST 49 aparece no preenchimento assistido como outras operações de saída, com base, alíquota e valor visíveis. Esse código não determina sozinho isenção. A classificação da mercadoria e a composição água/vasilhame devem ser conferidas pelo estabelecimento e sua contabilidade.

Verificação: `node scripts/test-postgres.js test/sale-editing.integration.test.js test/pdv.integration.test.js test/agreements.integration.test.js`; `node --test test/validation-message.test.js test/printing.test.js`. Testes de banco usam PostgreSQL descartável.


## Nova tentativa após rejeição

O PDV permite nova emissão do mesmo modelo quando a tentativa anterior está definitivamente `rejected`. O usuário precisa confirmar a conferência e enviar `rejectedDocumentId` e `rejectionReviewed:true` com um novo UUID. A migração 061 preserva a relação entre o documento rejeitado e seu substituto. Uma repetição do mesmo UUID retorna o documento existente. Status autorizado, desconhecido, pendente ou em revisão não liberam nova emissão. Nenhuma venda, pagamento ou estoque é criado novamente.

O adaptador do SDK mantém a chave alocada em `Id` não enumerável e configurável: a biblioteca NF-e precisa removê-la durante a montagem do XML. O teste `wizard-sdk-key.test.js` deve ser executado na imagem Linux, com `--network none`; cobre NF-e/NFC-e e cNF com zeros iniciais sem usar certificado ou transporte HTTP.
