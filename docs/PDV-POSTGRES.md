# Revisão e migração do PDV Ultragas

**Atualização:** [entregador persistido, importador PDF e página pública de pedidos](CLIENTES-ENTREGAS-PEDIDOS.md). As migrações 008–009 acrescentam esses fluxos; as pendências históricas correspondentes descritas abaixo foram atendidas nesta etapa.

Revisão em 27/10/2026, com foco na venda real por estabelecimento. A maquininha será externa, sem TEF integrado, conforme confirmado pelo responsável pelo projeto.

## Bloqueios encontrados e corrigidos

| Parte essencial | Situação anterior no PostgreSQL | Implementação atual |
|---|---|---|
| Acessar o PDV | App mostrava módulo em preparação; `/sales` não existia | Tela PostgreSQL própria, aberta no login de quem pode vender |
| Carrinho | Tela legada guardava carrinho sem usá-lo na persistência principal | Venda com vários produtos, quantidades, valores em centavos e desconto rateado |
| Preço e estoque | Serviço de venda dependia de MongoDB | Preço conferido no servidor, produtos bloqueados em ordem e baixa atômica; custo histórico preservado sem expor custo ao operador |
| Gravação duplicada | Sem comando idempotente de venda no novo banco | UUID por comando e hash canônico; repetição devolve a mesma venda; conteúdo diferente retorna 409 |
| Perda de conexão | Cliente poderia tentar novamente como outra venda | Comando exato salvo por usuário/unidade/aba antes do envio; recarregar mantém a tentativa a confirmar |
| Dinheiro e troco | Campos controlados pelo cliente | Servidor valida recebido >= total e calcula troco pelo pagamento registrado |
| Cartão | Checkout legado simulava aprovação, NSU e autorização | Confirmação explícita do operador e referência real da maquininha externa; nenhum acionamento/simulação de TEF no novo PDV |
| PIX | Serviço de PIX dependia de configurações Mongo | BR Code estático da unidade, CRC16 e valor do saldo; gerar QR não marca pagamento como recebido |
| Fiado / entrega | Recebimentos do novo banco inexistentes | Cliente identificado, vencimento para crédito, endereço para entrega e recebimentos parciais ou totais |
| Caixa | Fechamento legado somava vendas diárias sem separar adequadamente cédulas | Caixa por operador/unidade, fundo inicial, movimentos, sangria/suprimento, contagem física e diferença justificada |
| Cancelamento comercial | Sem implementação PostgreSQL | Gestor confirma devolução, informa motivo/referência externa, estoque volta uma vez e dinheiro é estornado no caixa atual |
| Fiscal | Fila independente, sem vínculo com venda; checkout antigo mostrava dados fictícios | Rascunho vinculado a venda paga, itens/totais/pagamentos conferidos, vínculo único com documento real e status assíncrono |
| Comprovante | Dependência do checkout simulado | Comprovante de venda verdadeiro, identificado como SEM VALOR FISCAL; chave/protocolo somente conforme registro fiscal |

Código principal: `src/postgres/sales.js`, `src/postgres/pix.js` e migração `007_pdv.sql`. App: `src/pages/PostgresSalesPage.jsx`, `src/services/pdv.js` e `src/components/pdv/usePdvRequest.js`. O modo PostgreSQL não usa `SalesPage.jsx`/`CheckoutInvoiceModal.jsx` legados. Modais globais Mongo de lançamento financeiro e importação fiscal também deixam de ser montados nesse modo.

## Transação da venda

O servidor valida o vínculo e a sessão ativa de empresa/estabelecimento, consulta a autorização de vendas, obtém o caixa aberto do operador e bloqueia os produtos em ordem. Confere preço atual e disponibilidade, calcula totais em centavos e grava venda, itens, baixa de estoque, movimento, recebimentos e notificações na mesma transação. Qualquer falha desfaz tudo.

O cliente não define total final, vendedor, data de venda, status de pagamento ou `invoiceIssued`. Um preço desatualizado retorna 409, permitindo atualizar preços/estoque no carrinho. Alteração de preço e desconto exigem permissão específica no backend. Quantidade duplicada do mesmo produto deve ser agrupada.

RLS e chaves estrangeiras compostas empresa/unidade também protegem clientes, caixas, vendas, itens, recebimentos, cancelamentos, movimentos e vínculos fiscais. Nenhum desses endpoints usa modelos MongoDB. Os registros contábeis do PDV são persistidos nos recebimentos, saldos pendentes e movimentos de caixa; os demais módulos financeiros legados não são montados para servi-los.

## Pagamento e caixa

- Dinheiro: operador confirma o recebimento e informa o total entregue pelo cliente. A entrada física é o valor líquido da venda/pagamento, após devolver o troco.
- PIX: confirmação manual após conferir crédito na conta da loja, com referência da transação. O QR estático usa a chave da unidade e o saldo pendente; não há webhook bancário nem confirmação automática. Referência técnica: [Manual de Padrões para Iniciação do Pix, BCB](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf).
- Crédito/débito: registrar apenas depois da aprovação na máquina externa e informar NSU/autorização. O sistema registra o recebimento bruto do cliente; conciliação de liquidação/taxas da adquirente é uma etapa separada.
- A receber: baixa o estoque ao registrar o pedido; guarda o saldo até recebimentos posteriores. Há filtro de pendências paginado no PDV e no atalho Contas a Receber. Cada recebimento exige caixa aberto de quem o registra. Não há geração automática de cobrança bancária.
- Fechamento: dinheiro esperado = fundo + recebimentos em dinheiro + suprimentos − devoluções em dinheiro − sangrias. PIX/cartões não compõem a contagem de notas/moedas. A contagem é preenchida explicitamente e a divergência exige observação.
- Cancelamento: depende de permissão de gestão, devolução física dos itens e confirmação do estorno. A devolução de dinheiro exige saldo suficiente no caixa do operador que está cancelando. O pagamento externo precisa ser estornado no banco/maquininha antes da confirmação no app. Venda vinculada a documento fiscal é bloqueada para cancelamento comercial direto.

Os valores confirmados por operadores são declarações manuais; o software não afirma ter recebido confirmação automática do banco/adquirente. Uma venda pode ter vários recebimentos e métodos. Reutilizar um identificador de pagamento em outra venda é rejeitado.

## Permissões por estabelecimento

| Permissão | Comportamento |
|---|---|
| `sales` | Abrir/fechar o próprio caixa, vender e consultar/receber as próprias vendas |
| `sales-collect` | Além de vender, consultar e receber vendas de outros operadores da mesma unidade |
| `sales-discount` | Aplicar desconto ou alteração autorizada de preço no backend |
| `sales-manage` | Consultar todas as vendas da unidade, cancelar e gerenciar ajustes |
| `cash-adjust` | Sangria/suprimento no próprio caixa, sem conceder cancelamento |
| `fiscal` | Preparar/enfileirar emissão e baixar XML autorizado; também exige acesso de venda para o fluxo vinculado |
| administrador da unidade | Acesso integral aos fluxos acima dentro daquela unidade |

Operador sem permissão de cobrança vê suas próprias vendas. O mesmo usuário em outra unidade recebe outro contexto/RBAC e outro caixa. Retornar à seleção não fecha automaticamente o caixa; ao voltar, o caixa aberto daquele operador/unidade é recuperado. Conceder permissões em cada vínculo de estabelecimento, conforme as ferramentas administrativas já existentes.

## Emissão vinculada à venda

No comprovante ou histórico, **Emitir NFC-e** carrega o rascunho com produtos, quantidades, preço, desconto, frete, destinatário e pagamentos derivados da venda. O usuário autorizado completa/confere NCM, CFOP e os blocos tributários aprovados pela contabilidade. A API recusa tributação vazia e divergência de itens, valores, pagamento ou destinatário. O sistema não presume tributação de GLP e não calcula automaticamente toda a tributação a partir de um preço.

Somente venda paga e ativa pode enfileirar NFC-e. O documento fica ligado à venda na mesma transação de sua criação/fila. O comprovante mostra a situação real: fila, envio, consulta, autorização, rejeição ou revisão. `invoiceIssued` é derivado de `status=authorized`; enfileirar não é autorizar. O rascunho original fica preservado em homologação, garantindo idempotência mesmo quando o SDK precisa usar as descrições de teste.

O comprovante comum continua sem valor fiscal. O XML só pode ser baixado após autorização e disponibilidade no banco. Não há geração de protocolo, chave autorizada, NSU ou aprovação aleatória no novo PDV.

## O que ainda impede afirmar que toda a operação está liberada em produção

1. **Ambiente real:** aplicar migrações 001–007 no PostgreSQL da EC2, provisionar logins restritos, executar API/workers, configurar HTTPS/CORS, bucket privado, VAPID e backups. Nenhum desses recursos foi alterado na AWS por esta revisão.
2. **Fiscal:** cadastrar certificado/CSC reais e validar com a contabilidade a tributação de cada operação. Executar uma homologação real antes de habilitar ambiente 1. O rascunho é editável por JSON para o usuário fiscal; ainda não existe motor tributário automático por produto, DANFE NFC-e, cancelamento fiscal, inutilização, contingência ou painel completo de reconciliação de eventos incertos. Esses fluxos fiscais precisam ser concluídos antes de considerar completo o ciclo de emissão/impressão/cancelamento. Falhas fiscais não autorizam cancelamento comercial às cegas.
3. **Dados anteriores:** a importação já disponível importa somente identidades, catálogo e dados da loja. Histórico de vendas, fiados/recebíveis antigos e fechamento de caixas Mongo ainda precisam de migração e conciliação próprias. Não reaplicar baixa de estoque de vendas históricas sobre o saldo de abertura importado. Não tratar flags fiscais simuladas antigas como notas reais.
4. **Fluxos especiais:** vale-gás/vouchers, Gás do Povo, comissões/gamificação, atribuição automática de entregador, despacho por Meta WhatsApp, pedidos por link e conciliação da adquirente não fazem parte do núcleo migrado nesta etapa. Não expor seus módulos legados como se usassem PostgreSQL.

O núcleo comercial foi implementado e validado localmente. A lista acima distingue dependências externas, parametrização contábil e funcionalidades ainda pendentes; não é uma declaração de operação fiscal homologada ou deploy concluído.

## Validação e reprodução

```sh
npm run test:postgres
npm run preview:pdv
```

O teste cria/remove somente um container PostgreSQL descartável. São 28 testes aprovados no conjunto de fundação, workers e PDV, incluindo isolamento, estoque concorrente, rollback integral, idempotência, troco, referência de pagamento, rateio, custo histórico, recebimentos parciais, permissão de cobrança, estorno, numeração e vínculo fiscal.

A prévia usa outra base descartável, API em 127.0.0.1:5501 e conta de teste impressa no terminal. Iniciar o app com `VITE_API_URL=http://127.0.0.1:5501/api/v1` em modo `postgres`. Interromper a prévia com Ctrl+C remove o container que ela própria criou. Ela nunca lê URLs do banco da aplicação e não emite notas nem aciona uma maquininha real.

Validação manual no navegador com API/PostgreSQL reais de teste: abrir caixa de R$ 100, vender 2 itens a R$ 120,45, perder a resposta HTTP após o commit, recarregar e recuperar a mesma venda; histórico mostrou um único registro e troco de R$ 59,10. Outra venda de R$ 10,01 no cartão externo manteve o dinheiro esperado em R$ 340,90. Cancelar a venda em dinheiro devolveu o caixa esperado a R$ 100 e permitiu fechar com diferença zero. Histórico conferido também em viewport 390×844. Dados e confirmações usados eram exclusivamente de teste.

O build do app e o lint dos novos arquivos passam. O lint global ainda identifica Hooks condicionais no checkout legado e avisos anteriores; o modo PostgreSQL não usa esse checkout. O build mantém o aviso de bundle acima de 500 kB.
