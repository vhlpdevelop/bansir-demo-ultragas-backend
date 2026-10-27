# Pedidos, fornecedores e central fiscal — 27/10/2026

Referências estudadas: Central de Estoque/Catálogo do Ultragas e módulos SuppliersPage, FiscalCertificatesSection, FiscalMonitoringSection, distribuição e fila fiscal do `bansir_retails`. O projeto de referência não foi alterado.

## Entrega

- Pedidos do link seguem a tipografia, cores, cartões e ações da central de estoque. Indicadores consultam todo o estabelecimento; busca, filtro e paginação usam a API. Pedidos novos aparecem primeiro, dos mais antigos para os recentes. Conferência mostra produtos, frete, total e entregador antes da conversão em venda a receber. As regras de caixa, estoque e idempotência foram preservadas.
- Fornecedores agora estão disponíveis no modo PostgreSQL: razão social, fantasia, CPF/CNPJ, IE, contato, endereço, categoria, dados bancários/PIX, observações e situação. Exclusão apenas desativa. Documento é único por estabelecimento; não houve importação automática de dados do MongoDB nem alteração do projeto de referência.
- Configurações → Certificado & NFC-e reúne identificação, validade e ativação do A1, cadastro do emitente/CSC/endereço/série/numeração, monitores e destinatários fiscais. PFX/P12 e senha permanecem criptografados no PostgreSQL; a senha é apagada do formulário após a tentativa. CNPJ do A1 precisa corresponder ao estabelecimento quando este já tem documento cadastrado. Substituição mantém um certificado por unidade.
- Busca de NF-e modelo 55 por CNPJ/UF/ambiente e NSU, via fila/NFeWizard. Retornos 137/138/656 e limites de XML/docZip são tratados. Resumos podem preceder o XML; documentos de outra unidade não podem ser listados ou baixados. XML recebido fica criptografado no PostgreSQL; XML de NFC-e autorizada segue o armazenamento S3 já existente.
- Ciência da operação é enfileirada apenas após confirmação explícita. A permissão é revalidada antes da chamada externa, e o retorno precisa corresponder à chave, ambiente, tipo e sequência do evento. Não há confirmação automática de recebimento físico, entrada automática de estoque ou criação automática de fornecedor a partir da nota.
- Alertas fiscais incluem novas notas/cancelamentos, situação de NFC-e e validade do A1. Destinatários são administradores ou membros com `fiscal-notify`, habilitados por unidade. A opção e a participação são revalidadas antes do push. Ciência exige `fiscal-manifest` e leitura fiscal (administradores já autorizados). As notificações usam a fila existente com deduplicação; push depende de VAPID, permissão do navegador e dispositivo registrado.

## Implantação e limites operacionais

Aplicar migração **013**, depois recriar API e notificações com a nova imagem. O worker fiscal chama o agendador controlado `schedule_fiscal_monitors`, que enfileira consultas e avisos de validade. API e workers usam os papéis restritos existentes e RLS por empresa/estabelecimento.

Para operar fiscal: configurar `FISCAL_S3_BUCKET` privado, `AWS_REGION`, acesso IAM ao prefixo fiscal e a mesma `FISCAL_ENCRYPTION_KEY` na API/worker. Habilitar `FISCAL_PRODUCTION_ENABLED=true` somente com credenciamento, A1, CSC, cadastro e tributação conferidos. Iniciar o serviço `fiscal` do Compose. O cadastro do monitor sozinho não executa consultas sem esse worker. Os indicadores da tela informam configuração de ambiente, não comprovam saúde do worker nem autorização SEFAZ.

No deploy atual, o worker fiscal segue pendente do bucket privado de documentos e seu acesso IAM. Não foi usada credencial fiscal real nem realizada emissão ou manifestação real para validar esta entrega. Consulta recebida e emissão NFC-e são caminhos distintos; produção só estará operacional após configuração e validação com o estabelecimento/contabilidade.

App: publicar o conteúdo do ZIP de produção na raiz de `bansir-gas-app-prod-1`, preservando o bloqueio público/OAC, e invalidar `/*` no CloudFront. Não enviar o ZIP como arquivo nem incluir uma pasta `dist/` no caminho das páginas.

## Validação

Suíte PostgreSQL em banco descartável: regressões de vendas/caixa/estoque, multi-tenant, permissões, certificados, fila, pedidos e importações; novos testes de fornecedores, distribuição, ciência explícita, XML criptografado, download isolado e cursor em bloqueio 656. SDK real rejeita certificados inválidos antes de chamadas externas nos caminhos de consulta, distribuição e ciência. Retornos fiscais de sucesso são simulados; não representam homologação na SEFAZ.

Build e validação CSS do app aprovados. Conferência Playwright com dados fictícios para pedidos em desktop/celular, fornecedores e configuração fiscal; sem erros de console nos fluxos conferidos. O lint geral mantém avisos anteriores, incluindo hooks da tela existente de fornecedores.
