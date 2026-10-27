# Clientes, entregadores e link de pedidos

**Atualização com os PDFs reais:** [colunas da Jasley, limites ampliados, revisão de saldos e frete fixo/por região exclusivo do dono](IMPORTACAO-JASLEY-FRETE.md). Aplicar também a migração 010. As observações abaixo sobre ausência do PDF e limite de 100 páginas refletem a etapa anterior.

Implementado em 27/10/2026 para o modo PostgreSQL. Complementa [o PDV](PDV-POSTGRES.md) e [a operação de produção](WORKERS-PRODUCTION.md). Aplicar todas as migrações, de 001 a 009, antes de iniciar esta versão da API.

## Entregador da venda

A aba **Entregadores** permite cadastrar, editar e desativar entregadores por estabelecimento. No PDV, qualquer venda pode receber um entregador. A venda guarda o identificador, nome e telefone no momento do registro; renomear ou desativar o cadastro não altera o histórico. A API rejeita um entregador de outra unidade. O comprovante e o histórico exibem o responsável informado.

## Importação dos clientes

Em **Clientes**, o administrador envia um PDF com texto selecionável. O servidor extrai linhas e apresenta uma prévia editável com origem e possíveis problemas. Nada é importado até a confirmação das linhas selecionadas. Limites: 5 MB, 100 páginas e 1.000 candidatos por arquivo. Documentos digitalizados sem texto precisam de OCR antes da importação.

Telefones brasileiros são normalizados com DDD e código 55. O importador permite ignorar números existentes ou atualizar explicitamente seus cadastros. Números ambíguos não são mesclados silenciosamente. A confirmação é transacional, auditada e idempotente: repetir a mesma tentativa não duplica os registros. O arquivo bruto não é publicado nem armazenado no S3.

**O PDF real ainda não foi fornecido.** A extração foi validada com PDFs sintéticos; o formato real precisa ser conferido na prévia e pode exigir ajuste no reconhecimento das colunas. A lista administrativa permite buscar e editar clientes da unidade selecionada.

## Página pública e configuração

O endereço público é `/pedir/<slug>`. Na aba **Página de pedidos**, o administrador escolhe o endereço, publicação, disponibilidade de pedidos, produtos, imagens HTTPS, nome, chamada, descrição, logo, contato, cores, estilo, regiões e taxas de entrega, retirada e avisos com diferentes tons. A tela possui prévia. O catálogo público mostra apenas produtos publicados e ativos, sem custo de aquisição ou quantidade exata de estoque.

O celular é o primeiro campo. Conforme decisão do responsável, **não há preenchimento automático de nome ou endereço nem resposta indicando se o cliente já existe**. O cliente informa esses dados manualmente. A correspondência pelo telefone acontece internamente; a equipe deve confirmar a identidade no atendimento. A solicitação pública não altera automaticamente o cadastro existente. Verificação de posse e preenchimento pessoal ficam para uma etapa posterior.

O cliente escolhe produtos e entrega ou retirada, visualiza frete e total e envia o pedido. Preços, publicação, disponibilidade e taxa são conferidos novamente no servidor. O acompanhamento usa um token opaco e permite consultar apenas o pedido da própria sessão. A página pública carrega separadamente do aplicativo administrativo.

## Atendimento e venda

Em **Pedidos do link**, usuários autorizados a vender recebem a fila da unidade. A equipe confere o contato, pode escolher entregador e aceita ou rejeita o pedido com motivo. A aceitação requer caixa aberto e registra uma única venda pendente, com os itens, endereço de entrega, frete e entregador. A baixa de estoque e a criação ou associação do cliente fazem parte da mesma transação. Antes da aceitação não existe reserva nem baixa de estoque.

O pagamento é registrado no PDV: dinheiro, PIX confirmado pelo operador ou cartão aprovado na maquininha externa. Não há cobrança automática pelo link nem TEF. Aceitações simultâneas ou repetidas devolvem a mesma venda. O cancelamento comercial da venda aceita atualiza também o acompanhamento público para cancelado. Pedidos rejeitados não geram venda.

## Isolamento e publicação

As migrações 008 e 009 acrescentam entregadores, importações, configuração e pedidos com escopo de empresa e estabelecimento. Chaves compostas e RLS impedem associações entre unidades. As transações públicas usam `SET LOCAL ROLE bansir_storefront`, com acesso restrito ao catálogo e à própria sessão; esse papel não pode consultar clientes nem custos. O contexto termina no commit ou rollback.

No S3/CloudFront do app, configurar fallback para `index.html` em `/pedir/*`, preservando o caminho. Compilar com `VITE_API_URL` apontando à API HTTPS PostgreSQL real; o modo administrativo é reconhecido pela sessão de autenticação retornada pelo backend. Configurar CORS para o domínio público e o cabeçalho `X-Checkout-Token`. O proxy de exemplo aceita corpo de até 8 MB, enquanto a API aplica limites específicos por rota e autentica antes de processar importações. Certificados continuam sujeitos ao limite próprio.

Imagens são URLs HTTPS configuráveis; este módulo ainda não inclui upload de imagens para S3. Nenhuma infraestrutura AWS foi publicada durante estes testes. A migração do histórico Mongo e a homologação fiscal real continuam sendo etapas separadas.

## Validação

35 testes de integração passam em PostgreSQL 17 descartável: isolamento/RBAC, planos, workers, PDV, entregador histórico, extração de PDF, importação atômica, catálogo público, proteção dos dados pessoais, preços/frete, aceitação concorrente, retirada, rejeição e cancelamento. O app compila. Os fluxos de importação, pedido público, aceitação e personalização também foram exercitados em navegador com dados fictícios. Emissão SEFAZ, push externo e recursos AWS não foram acionados.
