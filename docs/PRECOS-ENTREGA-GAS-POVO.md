# Preços do link, sábado e Gás do Povo

Migração 014. O catálogo PostgreSQL aceita `fulfillmentPricing` com `deliveryPrice`, `saturdayPickupPrice`, `saturdayDeliveryPrice` em reais, além de `gasDoPovo` e `gasDoPovoDelivery`. Valores antigos continuam funcionando sem configuração adicional. Nenhum produto de produção é identificado ou reprecificado automaticamente pelo nome.

## Cadastro

Em Produtos → Catálogo → Novo/Editar produto, o dono configura **Preços do link e Gás do Povo**. O preço normal da retirada é o campo já existente de preço de venda. Os campos novos são opcionais:

| Exemplo | Retirada normal | Entrega normal | Retirada sábado | Entrega sábado |
| --- | --- | --- | --- | --- |
| Gás | R$145 | R$150 | R$135 | R$140 |
| Água | R$12 | R$15 | R$12 | R$13 |

Há botões para preencher esses exemplos; o dono deve selecionar o produto correto e salvar. Os valores são por unidade. Campo de sábado vazio mantém o preço normal da respectiva modalidade. Sem preço de entrega, a entrega usa o preço da retirada, acrescido do frete geral.

O preço de entrega explicitamente configurado é final e inclui o frete daquele item. Carrinho composto apenas por esses itens não recebe taxa extra. Em carrinho misto, o frete geral fixo/por região é cobrado uma vez para os itens sem entrega inclusa. A escolha de região continua necessária para delimitar a área atendida.

Somente o dono pode alterar os preços por modalidade, a configuração de Gás do Povo e o fuso das promoções. A restrição existe na API e em triggers do PostgreSQL. Outros usuários com permissão de produtos continuam podendo editar os campos comuns; valores não configurados não são alterados.

O calendário usa o fuso definido em Página de pedidos → Frete e retirada (padrão America/Cuiaba). O servidor seleciona a data e revalida preço/frete no envio. O navegador renova o catálogo a cada minuto e ao recuperar foco. Se o preço mudar antes de confirmar, o envio é recusado até conferir os novos valores.

## Gás do Povo

Ao marcar o tipo, o formulário exige responder se faz entrega. Com entrega desabilitada, o produto mostra aviso e só pode ser adicionado para retirada. Trocar um carrinho que o contém para entrega bloqueia o envio. A API também rejeita a tentativa, inclusive via PDV, sem depender do botão do navegador. Se a loja não aceita retirada, esse produto não pode ser pedido pelo link.

Essa marcação controla catálogo/modalidade; não implementa validação de benefício, autorização do programa ou liquidação de voucher.

## Pedido e venda

O pedido guarda itens, preços finais, frete e contexto da data/fuso. Ao aceitar, a venda mantém esse orçamento mesmo depois do sábado ou de uma alteração de catálogo. O caminho interno de aceitação usa apenas os itens gravados no pedido; a API pública de vendas não aceita um orçamento arbitrário enviado pelo cliente. As regras de caixa aberto, estoque, entregador e idempotência permanecem.

Preços diferenciados são calculados pelo link; o PDV direto mantém seu fluxo atual de preço/desconto, com bloqueio de entrega para Gás do Povo restrito. O operador confere o valor de vendas diretas como antes.

## Worker fiscal e próxima etapa

Já existe worker fiscal com agendamento de distribuição de NF-e por CNPJ/NSU, manifestação de ciência e emissão/consulta de NFC-e. A operação na EC2 continua dependendo de bucket privado de XML, acesso IAM, A1/CSC/cadastro e habilitação fiscal; o worker não foi ativado com recursos fictícios.

A migração Baileys → Meta fica para a próxima tarefa: conexão de cada estabelecimento ao app WhatsApp, webhook autenticado de mensagens/status, fila com deduplicação e avisos de pedido recebido/em preparo/previsão de entrega. Nenhuma integração Meta ou comunicação real com clientes foi ativada nesta entrega.

## Verificação

Suíte PostgreSQL completa: 50 testes aprovados. Cobertura nova de preços normais/sábado, fronteira UTC/fuso, frete incluso/misto, bloqueio de programa, preservação do orçamento, requisição forjada e proteção do dono via SQL. Build/CSS aprovados. Playwright conferiu catálogo público com dados fictícios, troca de modalidade, valores de sábado e bloqueio do envio no desktop/celular.

Prévia descartável reproduzível: `node scripts/preview-pdv.js --pricing --saturday`, com app apontado para a API local em 5501. Não usa banco ou certificado de produção.
