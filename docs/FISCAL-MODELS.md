# Documentos fiscais de venda

- NFC-e é sempre modelo 65; NF-e é sempre modelo 55. O PDV permite escolher antes de enviar o documento de uma venda paga para a fila.
- As solicitações antigas sem `model` continuam no 65. Alterar modelo, operação ou conteúdo de uma solicitação idempotente retorna conflito.
- Migração 049 associa todos os contadores existentes ao 65 e inclui o modelo na chave do contador. O índice fiscal_issuer_number já protege CNPJ/modelo/série/número, inclusive entre unidades.
- Configurações fiscais mantêm `series`/`nextNumber` para 65. `nfeSeries`/`nfeNextNumber` são opcionais e devem ser cadastrados juntos para habilitar o 55. Confirmar os números com a contabilidade, principalmente se outro emissor já foi utilizado.
- NF-e 55 exige CPF/CNPJ válido, nome, endereço fiscal brasileiro, IBGE compatível com UF e IE para contribuinte. O usuário informa consumidor final/revenda e presença. Operações internas exigem CFOP iniciado em 5; interestaduais, em 6. A tributação continua sendo preenchida e revisada com orientação contábil, sem valores presumidos pelo sistema.
- O escopo é emissão normal de venda nacional (`tpNF=1`, `finNFe=1`). Exportação, devolução, complemento, substituição de NFC-e e cancelamento fiscal não foram acrescentados nesta alteração.
- Na NF-e o destinatário é informado e congelado no documento, sem editar automaticamente o cadastro comercial do cliente. Itens, descontos, frete, total e pagamentos continuam vinculados à venda. Uma venda já vinculada a documento não pode emitir outro modelo.
- O worker usa o modelo da chave para emitir e consultar. Falha incerta consulta antes de qualquer nova tentativa; armazenamento S3 não reemite.
- DANFE 55 usa A4 e código de barras, sem exigir QR Code de NFC-e. O PDF usa somente XML autorizado, com modelo/chave/ambiente/protocolo correspondentes. Datas são exibidas no horário original do XML. O DANFE A4 é aberto/baixado pelo navegador; impressão automática térmica permanece no 65.
- Fiscal e Relatórios identificam os dois modelos; RBAC e isolamento por estabelecimento permanecem os mesmos.
- `FISCAL_PRODUCTION_ENABLED` continua controlando emissão real, sem alteração automática. Receber NF-e de fornecedores é outro fluxo e não modifica estoque sem conferência física confirmada.

## Validação

Testes PostgreSQL descartáveis de PDV, worker e relatórios, testes unitários de destinatário/CFOP/chaves e testes Linux de PDF 58/80 mm e A4. A biblioteca de DANFE depende de libxmljs2 nativa disponível na imagem Linux; o teste A4 deve ser executado nessa imagem, não ignorado na validação da publicação. Não foi emitido documento real para testar a alteração.
