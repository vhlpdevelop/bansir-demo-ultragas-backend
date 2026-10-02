# Seed inicial e MongoDB como fonte de dados

Na pasta `bansir-demo-caroline-backend`:

```powershell
npm run seed:plan
npm run seed
npm start
```

`seed:plan` apenas mostra o plano, sem conectar ou gravar. `seed` popula o banco indicado por `MONGODB_URI` no `.env`. O banco padrão da URI Atlas sem nome é `bansir_saas`. A seed não roda automaticamente ao iniciar ou publicar o app.

## Conteúdo inicial

- 3 usuários: Caroline (`caroline@bansir.com.br`, superadmin), Helena (`helena@bansir.com`, gerente) e Lucas (`lucas@bansir.com`, operador).
- 5 categorias, 8 produtos e respectivas entradas de estoque inicial.
- 5 funcionários, com estatísticas de vendas, comissões e conquistas zeradas.
- Parâmetros iniciais de precificação, custos fixos e variáveis.
- Nenhuma venda, receita, despesa, assinatura push ou nota fiscal fictícia no modo padrão.

Os produtos, quantidades, salários, despesas e percentuais são exemplos da demo Caroline, para revisar antes de usar operacionalmente. Não são dados importados da loja. Os custos cadastrados na precificação são parâmetros, não pagamentos no livro financeiro.

A reexecução insere apenas registros ausentes. Preserva senhas, permissões, preços, estoque e configurações já cadastrados; não limpa coleções. A seed usa transação e o Atlas suporta esse recurso. MongoDB local precisa operar como replica set.

## Credenciais

O backend exige `MONGODB_URI` e `JWT_SECRET` no ambiente. O `.env` local está preparado; mantenha esses valores no Render.

O `.env` local já contém senhas aleatórias em `SEED_ADMIN_PASSWORD`, `SEED_MANAGER_PASSWORD` e `SEED_OPERATOR_PASSWORD`. Elas não são impressas e o arquivo é ignorado pelo Git. Consulte-o para fazer o primeiro login. Em outro ambiente, defina essas variáveis com pelo menos 12 caracteres. `SEED_ADMIN_EMAIL` pode alterar o e-mail inicial da Caroline.

Alterar essas variáveis e repetir a seed não redefine senhas de contas existentes. As variáveis `SEED_*` são necessárias apenas no ambiente onde você executar a seed. Se executá-la localmente apontando para o Atlas, o Render usará os mesmos registros sem precisar executar a seed novamente.

## Exemplos opcionais de movimentação

```powershell
npm run seed:demo
```

Além da base, grava duas vendas identificadas por `SEED-DEMO-*` (Pix e crédito em 3 parcelas) e uma despesa de R$ 50 identificada como `[Seed demo]`. As vendas reduzem estoque e geram recebíveis reais no banco selecionado. Reexecutar não duplica os exemplos nem repete a baixa. Use este comando somente se quiser esses exemplos no banco. Não envia push nem emite notas.

## Comportamento do app

MongoDB é obrigatório para usuários, catálogo, estoque, vendas, financeiro, precificação, notificações, dispositivos, configurações da loja, Pix e configuração fiscal. Sem conexão, a API informa indisponibilidade; não recorre a arrays ou arquivos JSON locais. Banco vazio retorna listas vazias. O backend falha na inicialização se não conseguir conectar.

O login valida senha no banco e o frontend consulta `/auth/me` antes de restaurar a sessão. Não existe login de demonstração ou troca local de cargo. No navegador permanecem somente token de acesso e preferências técnicas do dispositivo; dados de negócio não são persistidos localmente. Estado temporário de formulário e resultados da API em React são normais e não substituem o banco.

Arquivos financeiros antigos em `data/` não são importados nem lidos automaticamente. Dados preexistentes no Atlas são preservados.

Venda, baixa de estoque, histórico da movimentação, comissão e recebíveis são gravados na mesma transação. Falha em uma dessas operações reverte todas. Notificações são persistidas depois da venda; falha de push não desfaz a venda.

Emissão NFC-e e cobrança pela adquirente ainda precisam de integração real. As respostas fictícias de autorização foram removidas: essas ações retornam erro e não inventam nota ou pagamento aprovado. Pix copia e cola usa os dados da loja salvos em Configurações; não confirma recebimento bancário automaticamente.

## Validação

```powershell
npm test
npm run test:mongo
```

O primeiro executa testes locais; a integração é pulada sem `MONGODB_TEST_URI`. `test:mongo` usa a conexão configurada para criar um banco aleatório `bansir_test_*`, testa seed, login, permissões, rollback de vendas, recebíveis, precificação e push, e remove somente esse banco ao terminar. Nunca usa o banco do SaaS como alvo dos testes. O transporte push é simulado para não enviar notificações externas. Persistência também é consultada em um segundo processo Node.

Frontend: `npm run build` e `node --test test/push.test.js`.
