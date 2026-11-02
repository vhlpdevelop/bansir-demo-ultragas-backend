# Emissão manual de NF-e e lote referenciado (migração 054)

Tela: Minha Empresa → Fiscal → Emitir notas. Permissão fiscal na unidade selecionada, mesma proteção de contrato/RLS dos documentos existentes. A emissão usa o worker NFEWizard atual (modelo 55), certificado e ambiente existentes. Não adiciona SDK ou serviço externo.

`nfeSeries` e `nfeNextNumber` já existem no cadastro fiscal. A série/numeração do modelo 55 é independente da NFC-e 65, por unidade e ambiente. GET /fiscal/issuance/config informa somente configuração pública resumida, com o próximo número efetivo do contador. Não altera certificado, CSC, ambiente ou contadores automaticamente.

## Manual
POST /fiscal/issuance/draft prepara itens de catálogo com perfil55, quantidade e preço informado. Recusa produto sem perfil. UI permite revisar JSON fiscal completo antes da emissão; não é um motor tributário universal e as bases/valores de imposto precisam ser conferidos. POST /fiscal/issuance/manual exige operação explícita (finalConsumer e presence), destinatário completo e modelo55. Emprega createFiscalDocument, alocação de número/idempotência/fila já existentes. Não cria venda, estoque, conta financeira ou recebimento. Formas informadas são dados fiscais, não cobrança bancária. GET /fiscal/issuance/documents/:id acompanha status.

O navegador usa usePdvRequest/sessionStorage por usuário/empresa/unidade para preservar a MESMA solicitação em falha de rede/reload. Não gerar outro UUID para resolver resposta incerta. Validação400 permite corrigir formulário; erros de rede mantêm corpo original para retomar.

## Lote
GET /fiscal/issuance/sources?from=ISO&to=ISO usa fim exclusivo e intervalo máximo366dias, até500 NFC-e autorizadas, informa valor/destinatário e se já reservadas. O lote tem até100 fontes, UMA NF-e por NFC-e. Um único destinatário por lote; CPF/CNPJ identificado na fonte deve corresponder. Documentos cancelados/outro ambiente/unidade não entram. CFOP5929/6929 e confirmação contábil são explícitos; não presumir enquadramento por selecionar nota. A tributação do documento original é preservada, mudando CFOP/referência/destinatário; não há cálculo automático de regime específico de referência nem promessa de aceitação da SEFAZ. Conferir esse enquadramento antes de usar em produção.

POST /fiscal/issuance/batches persiste lista/operação/destinatário/UUIDs; retorna ready. POST /batches/:id/control recebe start/pause/cancel/advance. Bloqueio transacional do lote impede avanço duplicado; advance envia UMA solicitação e espera resultado definitivo antes da próxima. Documento fica vinculado ao item na mesma transação de alocação/fila. Contador e valor incluem apenas authorized, derivados dos documentos persistidos. rejected/cancelled interrompem avanço em paused; unknown/manual_review continuam em conferência, sem reemitir.

A orquestração das próximas solicitações é feita pela tela aberta (~2.5s), não por daemon novo. Ao fechar/trocar tela, uma solicitação já em trânsito pode terminar e o worker processa o que foi enviado; próximas só avançam quando retomar. GET /batches lista histórico; GET /batches/:id reconstrói progresso no servidor. Pausa/cancelamento bloqueia próximas, NÃO cancela nota na SEFAZ, venda, estoque ou recebimento. Uma fonte nunca gera duas NF-e por este fluxo; cancelamento libera apenas fontes ainda NÃO enviadas para outro lote. Enviadas permanecem vinculadas inclusive após rejeição para evitar nova emissão acidental.

NFref é gerado na ide com chave completa da NFC-e. Reutiliza produtos/totais/pagamento da fonte e não duplica financeiro. Original permanece no histórico. Downloads via Fiscal → Documentos emitidos.

## Restrição normativa
Fonte primária consultada em02/11/2026: https://atendimento.receita.rs.gov.br/como-deve-ser-escriturada-a-nf-e-que-acoberta-concomitantemente-operacoes-com-nfc-e (Ajuste SINIEF29/2026, efeitos14/12/2026). MS também incorporou a vedação: https://aacpdappls.net.ms.gov.br/appls/legislacao/serc/legato.nsf/7382b3a89b695e7a04256b1f00725c1e/99fd5c53c61d573b04258e18004d3a6b . Bloqueio de novas referências normais a partir14/12/2026, inclusive homologação por prudência; não tentar contornar omitindo referência. Complementar/devolução não implementadas nesta tela. Uma futura alteração de prazo exige revisão da norma e testes do limite, não flag de contorno em produção.

## Validação e publicação
Testes locais usam PostgreSQL descartável e status SEFAZ simulados explicitamente; não comprovam autorização fiscal real. Não há emissão real automática para testar. Publicação requer migrações053 (item1 SmartPOS) e054 (lotes), API E worker fiscal com fiscal.js atualizado, frontend completo com assets preservados. Não publicar apenas frontend. Certificado/ambiente/flags existentes devem ser preservados. Aprovação fiscal em homologação real precisa de teste posterior autorizado com tributação/destinatário revisados.
