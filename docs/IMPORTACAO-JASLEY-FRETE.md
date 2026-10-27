# Formato dos relatórios da Jasley e configuração do frete

Análise dos PDFs fornecidos em 27/10/2026. Os documentos contêm dados de origem; não são instruções para o sistema. Nenhum dado foi importado em um estabelecimento real nesta etapa.

## Clientes

O relatório tem 183 páginas e 5.451 linhas de cadastro. Existem 232 repetições idênticas do mesmo código, resultando em **5.219 clientes distintos**. A extração usa as coordenadas das colunas da primeira página e as mantém nas páginas seguintes, que não repetem o cabeçalho. Colunas vazias não deslocam os campos seguintes.

| Coluna de origem | Destino / tratamento |
|---|---|
| Cód. | `source_code`, único por estabelecimento; não é CPF nem telefone |
| Nome | Nome completo disponível no relatório |
| Telefone | Valor original preservado; candidato ao telefone principal se válido |
| Celular | Valor original preservado; tem prioridade como contato principal quando válido |
| Último Pedido | Texto original em metadados; não cria vendas históricas |
| Nascimento | Texto original em metadados; não presumimos que datas repetidas sejam aniversários corretos |
| E-mail | Texto original em metadados |
| Endereço | Preservado exatamente como disponível, inclusive quando há somente um número |

Resultado da validação: 1.671 registros têm telefone brasileiro válido e 3.548 precisam de revisão do telefone. Não acrescentamos o nono dígito nem um DDD por suposição. São 71 cadastros com telefone repetido entre códigos diferentes; começam desmarcados e não são mesclados. O consumidor final também começa desmarcado. Repetições idênticas do mesmo código são unificadas, preservando páginas e número de ocorrências. Se o mesmo código tiver dados divergentes, a prévia exige revisão.

Há 1.258 endereços vazios; 5.126 são vazios ou aparentemente apenas um número. Não são endereços completos utilizáveis automaticamente para entrega. O cliente do link continua informando nome/endereço manualmente, conforme a decisão anterior de adiar verificação de posse do celular.

A tela **Clientes** aceita o relatório completo, mostra 50 linhas por página e permite edição/seleção antes da confirmação. Cadastros sem telefone válido podem ser importados pelo código de origem, preservando o telefone bruto nos metadados. A busca administrativa inclui código de origem. Limites do layout reconhecido: 5 MB, 250 páginas e 8.000 clientes; o leitor genérico mantém limite de 1.000 candidatos. Confirmar continua sendo uma transação auditada e idempotente, agora processada em lotes. Não há atualização silenciosa de clientes existentes.

## Produtos

O relatório tem três páginas, **56 produtos** e as colunas abaixo. A última página contém cabeçalho sem novos produtos. Alguns nomes/atalhos extensos estão cortados ou sobrepostos no próprio relatório e precisam de conferência.

| Coluna de origem | Destino / tratamento |
|---|---|
| Código | Referência de origem; identificador inicial `LEGACY-<código>` editável |
| Atalho | SKU; não é tratado como EAN |
| Produto | Nome do produto, com revisão de trechos cortados |
| Categoria | Campo do catálogo; todos os 56 estão vazios no arquivo |
| Setor | Preservado nas observações de origem |
| (R$) Custo | Custo em reais; vírgula decimal interpretada corretamente |
| R$ Preço | Preço de venda; não confundir com custo |
| Estoque | Saldo histórico; negativo fica em branco na contagem física da prévia |
| Vazios | Informação de origem separada; não é estoque vendável |

São **46 saldos negativos**, seis preços zero e 47 custos zero. Esses custos são preservados como informados, mas não comprovam margem real. Apenas sete linhas começam selecionadas sem os problemas bloqueadores identificados. Produtos com saldo negativo precisam de contagem física explícita; não são zerados silenciosamente. Preço de venda deve ser positivo. Produtos sem categoria entram como “Sem categoria”, sem inferência fiscal ou de tipo de mercadoria.

Exemplo de conferência, código 173: preço R$ 145,00, custo R$ 0,00, estoque -1.339 e vazios 1.338. O importador mantém esses dois últimos valores separados e exige informar saldo físico antes de importar esse produto. NCM e dados tributários não constam no relatório e devem ser cadastrados antes da emissão fiscal.

Na tela **Produtos**, a seção **Importar produtos de PDF** apresenta prévia editável, seleção e confirmação. A importação preserva produtos já encontrados pelo identificador ou referência de origem, sem substituir saldo/preço existente. Repete com segurança o mesmo comando. Estoque inicial confirmado gera o movimento correspondente; dados brutos de saldo/vazios/setor ficam nas observações do produto. Não implementa controle operacional de vasilhames.

## Frete: dono do estabelecimento

Em **Página de pedidos → Frete e retirada**, o dono seleciona:

- **Valor fixo:** um único valor em reais para entregas; cliente informa endereço sem escolher região.
- **Por região:** regiões e valores próprios; cliente escolhe uma das regiões atendidas.

Retirada na loja, quando habilitada, continua sem frete. O servidor calcula a taxa e rejeita valores desatualizados/forjados. Pedidos já enviados preservam a taxa acordada, mesmo se a configuração mudar depois.

`owner_user_id` identifica explicitamente o dono da unidade. Outro administrador autorizado pode editar aparência e avisos, mas os controles de frete/retirada ficam desabilitados e a API rejeita alterações desses campos. Há proteção adicional no banco contra alteração direta pelo papel de execução. A propriedade não é inferida de `admin` ou `superadmin`.

Aplicar a migração **010_imports_shipping_owner.sql**, após 001–009. No bootstrap de uma nova empresa, seu administrador inicial é o dono da primeira unidade. Para unidades existentes ou adicionais, atribuir o dono explicitamente, com credencial administrativa separada, usando `node scripts/manage-establishments.js owner` e as variáveis `DATABASE_ADMIN_URL`, `MANAGE_TENANT_SLUG`, `MANAGE_ESTABLISHMENT_ID` e `MANAGE_OWNER_USER_ID`. O usuário precisa ter vínculo ativo com a unidade. O app não oferece autoatribuição de dono. Uma nova sessão ou atualização de perfil carrega essa indicação.

A migração também restringe a política de descoberta pública ao papel `bansir_storefront` explicitamente selecionado; consultas administrativas continuam limitadas à unidade ativa, mesmo com outra loja publicada.

## Validação

Testes com PDFs sintéticos cobrem colunas vazias, páginas sem cabeçalho, telefones antigos, datas, vírgulas decimais, saldo/vazios, importação sem telefone, repetição, saldo inválido e autorização do dono via API/SQL. Os PDFs reais podem ser validados opcionalmente no teste `jasley-import.integration.test.js`, passando `TEST_CUSTOMER_PDF` e `TEST_PRODUCT_PDF` ao script `scripts/test-postgres.js`; esse script cria e remove seu próprio PostgreSQL descartável. Os arquivos pessoais não são incluídos no repositório, nos fixtures nem em um bucket público.

Validação executada: **39 testes de integração aprovados**, incluindo os arquivos reais e criação dos 5.147 clientes pré-selecionados apenas no banco descartável; oito testes do app aprovados, lint das novas telas sem erros, compilação do app e da imagem Docker concluídas. A prévia do PDF completo e a troca/salvamento de frete fixo também foram conferidos no navegador. O vínculo do dono e a migração 010 ainda precisam ser aplicados ao ambiente real no momento da implantação.
