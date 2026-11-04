# Revisão de venda finalizada

Administradores e perfis com `sales-manage` podem abrir **Editar venda** nos detalhes do cupom. As abas **Produtos e valores** e **Pagamentos** permitem revisar quantidade, preço unitário por linha, desconto, frete e recebimentos manuais. É possível manter os pagamentos, substituir as formas/valores, dividir pagamentos ou deixar saldo pendente. O catálogo e o número do cupom são preservados.

Alterações comerciais exigem caixa atual aberto no navegador/terminal correto, motivo e confirmação dos valores/quantidades/pagamentos. A diferença de quantidade movimenta o estoque. O pagamento anterior é preservado e recebe uma reversão auditada; os recebimentos corrigidos são novos registros. Devoluções/entradas em dinheiro são compensadas no caixa atual, com validação de saldo. A operação não cobra nem estorna bancos/maquininhas.

O caixa de origem pode estar fechado: seus registros e valores de fechamento não são reescritos. O histórico de saldos usa os valores e pagamentos válidos até aquele fechamento, enquanto o ajuste financeiro aparece no caixa atual. Financeiro registra os recebimentos originais, suas reversões e os recebimentos corrigidos, sem duplicar receita líquida. Consultas de saldo e emissão fiscal usam somente `active_sale_payments`; relatórios de movimentos mantêm o histórico.

Cliente, endereço, observações e tributação continuam editáveis sem ajuste financeiro ou caixa aberto. Dados fiscais exigem também `fiscal`. O motivo é obrigatório e a auditoria registra usuário, hora, versão, valores e dados anteriores/posteriores. A migração 063 adiciona reversões append-only com RLS, view `security_invoker` e trigger que impede invalidar um pagamento sem auditoria/caixa aberto.

Vendas vinculadas a convênio/vale ou pagamento SmartPOS aprovado exigem seu fluxo específico. Mudança de total com comissão positiva registrada exige revisar a comissão; nenhum percentual histórico é presumido. Em vendas do link, pagamentos podem ser corrigidos, mas produtos/valores comerciais exigem revisão do pedido para preservar sua confirmação original. Edição não inclui adicionar/remover produtos: as quantidades dos itens existentes continuam positivas.

**Operação/rollback:** aplicar 063 antes da versão nova. Depois de existir reversão financeira, retornar a uma API antiga que soma a tabela bruta `sale_payments` daria saldo incorreto; qualquer rollback deve preservar o suporte a `active_sale_payments` e às reversões. Não remover a migração/auditoria para voltar de versão.

**Fiscal dos itens → Carregar fiscal atual do catálogo** copia a configuração para conferência. Escolher NF-e 55 ou NFC-e 65 e salvar a revisão permite corrigir a tributação congelada de um cupom antigo antes da emissão. Essa ação não emite notas. A atualização do catálogo sozinha continua sem reescrever vendas anteriores.

Venda cancelada, documento fiscal vinculado, reserva de lote ou cobrança SmartPOS pendente bloqueiam a edição. Endereço operacional de pedido/entrega vinculado exige o fluxo próprio de entrega; o endereço fiscal pode ser revisto separadamente. Alterar uma nota já emitida exige o fluxo fiscal adequado.

API: `GET /sales/:id/edit` e `PATCH /sales/:id/edit`. O PATCH recebe UUID de tentativa, versão esperada, motivo e campos explícitos. A migração 060 cria auditoria com RLS e libera apenas as colunas necessárias. Repetição da mesma tentativa não cria outra revisão; conflito de versão não sobrescreve outra alteração.

Tributação PIS/COFINS CST 49 aparece no preenchimento assistido como outras operações de saída, com base, alíquota e valor visíveis. Esse código não determina sozinho isenção. A classificação da mercadoria e a composição água/vasilhame devem ser conferidas pelo estabelecimento e sua contabilidade.

Verificação: `node scripts/test-postgres.js test/sale-editing.integration.test.js test/pdv.integration.test.js test/agreements.integration.test.js`; `node --test test/validation-message.test.js test/printing.test.js`. Testes de banco usam PostgreSQL descartável.


## Nova tentativa após rejeição

O PDV permite nova emissão do mesmo modelo quando a tentativa anterior está definitivamente `rejected`. O usuário precisa confirmar a conferência e enviar `rejectedDocumentId` e `rejectionReviewed:true` com um novo UUID. A migração 061 preserva a relação entre o documento rejeitado e seu substituto. Uma repetição do mesmo UUID retorna o documento existente. Status autorizado, desconhecido, pendente ou em revisão não liberam nova emissão. Nenhuma venda, pagamento ou estoque é criado novamente.

O adaptador do SDK mantém a chave alocada em `Id` não enumerável e configurável: a biblioteca NF-e precisa removê-la durante a montagem do XML. O teste `wizard-sdk-key.test.js` deve ser executado na imagem Linux, com `--network none`; cobre NF-e/NFC-e e cNF com zeros iniciais sem usar certificado ou transporte HTTP.
