# Financeiro e precificação

## Publicação

Publique backend e frontend juntos. O backend permite o cabeçalho X-Device-Id no
CORS; o frontend envia a identificação do aparelho no corpo ou na query, sem
adicionar esse cabeçalho a todas as chamadas. Uma versão antiga no Render não
é atualizada por uma alteração local.

No Render, configure NODE_ENV=production e MONGODB_URI. O financeiro usa MongoDB
para lançamentos e parâmetros da loja. Banco vazio permanece vazio e erros de
consulta/gravação são retornados ao cliente, sem substituição por exemplos.
MongoDB é obrigatório em qualquer ambiente. O armazenamento local em arquivos foi removido. A seed inicial está documentada em [SEED.md](SEED.md).

As configurações de preço pertencem à loja desta demo. Não há isolamento por
empresa implementado nestes modelos; um SaaS multiempresa precisa de identificação
e filtros por empresa antes de compartilhar o banco entre clientes.

## Precificação

O rateio é (despesas fixas + salários indiretos) / receita mensal prevista.
A previsão inicial de R$ 52.000 mantém aproximadamente o rateio anterior da demo;
ajuste-a para a realidade da Caroline. Não é uma previsão calculada por IA.
O custo informado da peça deve incluir aquisição/produção e mão de obra direta.
A capacidade e o custo por hora continuam como indicadores auxiliares; o preço
usa o rateio percentual para não somar a mesma estrutura duas vezes.

O preço à vista é custo / (1 - impostos - variáveis - comissão - rateio - margem).
A margem de contribuição exclui impostos, variáveis e comissão. A taxa de
parcelamento é ADICIONAL à taxa já incluída nas despesas variáveis e entra no
mesmo denominador para preservar os percentuais planejados. Não informe a mesma
taxa duas vezes. Valores zero são preservados; valores negativos/não finitos e
somas de percentuais iguais ou superiores a 100 são rejeitados.

Os parâmetros são persistidos. Funcionários sem comissão percentual não geram
uma comissão fictícia. Comissões fixas por venda precisam estar incluídas no custo
da peça ou em um parâmetro manual adequado; a média automática cobre percentuais.
As despesas de precificação são um orçamento, não lançamentos automáticos no caixa.
Alterar um lançamento do caixa não modifica esse orçamento automaticamente.

## Caixa, recebíveis e histórico

Os indicadores incluem somente lançamentos liquidados e não mudam com o filtro
da tabela. A receber e a pagar são informados separadamente. O histórico agrupa
os últimos seis meses pela data de liquidação; os totais dos cards são acumulados.
O saldo é dos lançamentos registrados, não saldo bancário conciliado nem lucro contábil.

Novas vendas no crédito/débito geram recebíveis pendentes pelo valor líquido da taxa
informada. Parcelas dividem centavos sem perder valor e vencimentos respeitam o fim
do mês. Sem uma data informada, a previsão inicial é 30 dias para crédito e 1 dia
para débito; ajuste à operadora. A previsão não liquida automaticamente a parcela.
Administradores confirmam o recebimento na tela Financeiro. Pix/dinheiro geram
entrada liquidada. Não há integração de conciliação com a operadora.

Venda, baixa de estoque, histórico de movimentação, comissões e recebíveis são gravados em uma única transação MongoDB. Falha em qualquer etapa reverte tudo. A ação Regularizar financeiro continua disponível para vendas antigas; usa venda/parcela como chave para não duplicar recebíveis. Emissão fiscal fictícia foi removida e depende de integração real.

Lançamentos históricos já classificados como completed não são reclassificados
automaticamente: revise os recebimentos antigos antes de tratá-los como caixa real.
O identificador do responsável agora usa sellerName, conforme o modelo.

## Permissões e testes

Administradores têm acesso. Outros usuários precisam das permissões financeiras
correspondentes cadastradas no backend. Salvar regras, aplicar preços e confirmar
liquidações exigem administrador. Permissões atuais são consultadas no MongoDB em cada requisição,
e não confiadas apenas ao papel antigo contido no token.

Execute `npm test` para testes locais e `npm run test:mongo` para testes em um banco isolado no Atlas, incluindo persistência entre processos, seed idempotente, rollback de venda, permissões, recebíveis, notificações e dispositivos. O transporte push é simulado. Não há teste de liquidação bancária por operadora. No frontend, execute `npm run build` e `node --test test/push.test.js`.
