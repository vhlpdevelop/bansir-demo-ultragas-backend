# PDV: pagamentos manuais e divididos

Crédito/débito dispensam integração, NSU e autorização. Crédito guarda 1–24 parcelas; débito tem uma. PIX mantém confirmação/referência manual. Nenhuma autorização bancária é simulada.

Pagamento dividido aceita 2–10 partes positivas, com soma exata ao total. Dinheiro recebido não pode ser menor que a parte em dinheiro. Todo o registro permanece em uma transação com estoque, caixa e idempotência da venda; somente o valor líquido em dinheiro entra no caixa físico. Parcelas do cartão são metadados do pagamento, sem criar uma nova dívida do cliente.

A interface apresenta falta/troco com sinal e impede finalizar valores insuficientes/inconsistentes. Os pagamentos e parcelas constam nos detalhes/comprovante.

NFC-e: um detPag por pagamento, tPag 01/03/04/17, cartão não integrado tpIntegra=2, sem cAut inventado. Crédito com parcelas usa indPag=1. Cash vPag representa recebido e vTroco representa troco real; validação exige soma(vPag)-vTroco=vNF. Não se cria duplicata fiscal fictícia para parcelas do cartão. Referência: MOC Anexo I, grupo YA (portal nacional NF-e/CONFAZ). Regras específicas de integração variam por UF do emitente; preparar XML não garante autorização SEFAZ. Emissão real continua bloqueada pela configuração existente.

Migração 031 adiciona parcelas com restrição por método. Testes PDV/Meta em banco descartável passaram. Build AWS gerado. Publicar ZIP inteiro, assets/ primeiro e index.html por último, manter assets antigos, invalidar CloudFront e verificar JS/CSS públicos. Não tornar bucket público.
