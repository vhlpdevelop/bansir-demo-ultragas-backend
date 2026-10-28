# Gestão em PostgreSQL

Aplicar a migração 019 antes de publicar a API. Ela acrescenta funcionários, lançamentos financeiros, parâmetros de inteligência, adiantamentos e snapshots de comissão. Todas as tabelas têm RLS forçada por empresa/estabelecimento e referências compostas. Nenhum módulo de gestão novo importa modelos ou serviços MongoDB.

## Financeiro

O fluxo combina lançamentos manuais com pagamentos efetivos do PDV. Uma venda não gera outra receita manual: cada pagamento aparece uma vez. O saldo ainda não pago da venda aparece em contas a receber. Estornos aparecem como saídas na data do cancelamento. Depósitos e sangrias do caixa físico não são receitas/despesas comerciais e não entram automaticamente no resultado gerencial.

Lançamentos manuais podem ser entradas ou saídas, pendentes ou realizados, com vencimento. A criação é idempotente pelo UUID persistido no navegador. Confirmar pagamento exige administrador; recebíveis do PDV devem ser recebidos pelo próprio PDV para manter o saldo da venda correto. Pagamentos e lançamentos de outra unidade nunca são alterados. Contas manuais não movimentam o caixa físico do operador. Este fluxo não implementa conciliação bancária, TEF ou taxas/agenda de repasse da adquirente.

Administradores gerenciam os lançamentos. Perfis delegados podem consultar apenas as seções explicitamente permitidas: `financial-overview`, `financial-payables`, `financial-receivables`, `financial-intelligence`; `financial` concede consulta às quatro. A permissão `sales` continua permitindo consultar/receber vendas pendentes pelo PDV.

## Funcionários e comissões

Cadastro administrativo inclui salário, MOD/MOI, comissão percentual ou fixa, PIX, contato e vínculo opcional ao usuário do caixa **deste estabelecimento**. Esse cadastro não cria login nem modifica o RBAC do usuário. Desativar preserva o histórico; editar permite reativar.

Nas vendas futuras do usuário vinculado, o banco registra funcionário e valor da comissão vigentes na venda. Alterar a comissão posteriormente não altera o histórico. Os indicadores consideram somente vendas integralmente pagas e não canceladas. Vendas antigas sem snapshot não recebem comissão presumida. O vínculo do vendedor não substitui o entregador já gravado pelo PDV; indicadores de funcionários nesta entrega refletem o vendedor, sem atribuição inventada de entregas.

Adiantamentos geram uma saída financeira e podem atualizar a quilometragem de um veículo da mesma unidade na mesma transação. A quilometragem não pode diminuir. Retry não duplica adiantamento nem despesa. Confirmar desconto em folha exige referência da folha e registra ator/data; essa confirmação não gera outra saída. Ao pagar a folha, lançar o valor líquido após adiantamentos, evitando duplicação. Cancelamento/estorno de adiantamento exige conciliação, e não é permitido cancelar seu lançamento isoladamente.

## Inteligência

Reutiliza o cálculo puro anterior de markup, despesas, capacidade e folha, com armazenamento dos parâmetros por estabelecimento. Os valores iniciais são parâmetros de simulação; ajustar receita prevista, impostos, margem e despesas para a realidade da loja. A folha é incluída no custo simulado, sem criar pagamento automaticamente. Aplicação de preço exige administrador e parâmetros válidos.

## Relatórios

Seis consultas/exportações PDF: consolidado, vendas, estoque atual/alertas, documentos fiscais, equipe/comissões e auditoria de Vale Gás. Datas são interpretadas no fuso do estabelecimento. Vendedor/categoria/pagamento/situação filtram vendas; fluxo financeiro permanece referente ao conjunto de movimentações do período, e o estoque é a posição atual. O período máximo é um ano; relatórios de vendas acima de 5.000 registros exigem período menor. Não se presume autorização fiscal nem lucro líquido a partir de estoque: a margem bruta exibida é venda menos custo histórico dos itens, antes das despesas.

As interfaces PostgreSQL usam as novas APIs, preservando o cadastro de funcionários e a tela de inteligência. Fluxo e relatórios possuem consultas compatíveis com os dados normalizados atuais. O código legado permanece separado e não é ativado para atender essas telas. Dados históricos do MongoDB e seus parâmetros não são importados automaticamente; essa migração de dados exige uma origem/backup e conciliação específica.

`node scripts/test-postgres.js` verifica isolamento/RBAC, pagamentos/estornos reais, idempotência, preservação das comissões, adiantamentos, desconto em folha, cálculo e PDF em PostgreSQL descartável, sem chamar bancos de produção.
