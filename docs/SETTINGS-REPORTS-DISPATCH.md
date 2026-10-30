# Distribuição, configurações e relatórios

## Distribuição de entregas

Fila com busca e filtro de situação, priorizando pedidos aguardando entregador e tentativas pendentes. Detalhes do pedido em painel separado; equipe em cartões com disponibilidade, carga e última posição autorizada. Vínculo de conta e explicação da sugestão são recolhidos. Edição de destino captura a versão ao abrir o formulário, evitando sobrescrever uma alteração concorrente. O painel mostra até 200 pedidos recentes; o histórico completo é consultado por período em Relatórios.

## Configurações pessoais e direitos administrativos

Todas as contas têm Minha conta, alteração de senha, Notificações/PWA e preferências locais de impressão. A aba de equipamentos só consulta integração administrativa quando há direito; configurar impressora local não exige ler credenciais da loja.

| Direito | Libera |
| --- | --- |
| settings-store | Dados da loja/Pix/contato e editor do link de pedidos |
| settings-fiscal | Certificado A1, cadastro NFC-e e monitor/recipientes fiscais |
| settings-terminals | Cadastro, ativação e desativação de terminais e integração de equipamentos |
| settings-whatsapp | Configuração e operação da integração WhatsApp, sob contrato |
| settings-infrastructure | Aba de informações da infraestrutura |
| fiscal | Consulta de documentos/XML, independente de configurar certificado |
| fiscal-manifest | Ciência de notas; exige também fiscal |
| fiscal-notify | Elegibilidade para avisos fiscais; não libera documentos/configurações |

Administradores mantêm acesso completo. Cargo Gerente sem direitos selecionados não libera configurações administrativas. A permissão antiga settings preserva acessos anteriores: para restringir, desmarque-a e use os direitos específicos. Ela não substitui a delegação explícita de gerenciamento de terminais/WhatsApp para não administradores. Frete/retirada no link continua protegido pela regra já existente de proprietário.

A API verifica a categoria pela rota, sem tratar qualquer settings-* como acesso a todas as configurações. Pareamento e operação de caixa continuam exigindo sales, mesmo quando o usuário pode gerenciar terminais. Relatórios completos incluem dados financeiros e de equipe: conceda reports de acordo com essa abrangência. Acesso a usuários/configurações dentro de relatórios permanece exclusivo do administrador.

Migração 042 adiciona o campo de contato da loja e ajusta meta_sender_active para revalidar especificamente o direito WhatsApp. Credenciais e autorizações existentes são preservadas; não há disparos externos nos testes.

## Cobertura dos relatórios

O catálogo GET /api/v1/reports/catalog lista 33 modalidades, sua referência de data e disponibilidade por contrato/perfil. Consolidado contém vendas e todas as seções disponíveis, inclusive vazias. Cada seção pode ser aberta na interface; PDF percorre todas as seções e CSV consolidado usa Relatório/Registro/Campo/Valor. PDF e CSV de uma modalidade usam o período consultado, não alterações de filtro ainda não aplicadas.

Cobertura: vendas, itens vendidos, pagamentos/parcelas, cancelamentos/devoluções, lançamentos financeiros, contas a pagar/receber, caixas/terminais/operadores e movimentos, catálogo/estoque e movimentos, notas emitidas e recebidas, equipe/comissões, adiantamentos, vales, pedidos do link, entregas, desempenho por entregador, auditoria de entregas, categorias, parâmetros de precificação, processamentos fiscais/avisos, auditoria de terminais, clientes, fornecedores, frota/manutenção configurada, terminais/vínculos, atividade WhatsApp, notificações próprias, usuários/permissões e configurações/integrações.

Entregas realizadas são contadas por delivered_at, somente status delivered; registros legados sem confirmação não aumentam o indicador. Outras situações da listagem usam a última alteração. Desempenho apresenta entregues e saídas no período, falhas ainda pendentes alteradas no período e carga atual, além de tempo médio apenas quando saída/conclusão válidas existem. Não estima quilômetros reais, combustível ou economia sem dados. Histórico de reatribuições não prova quem fez uma tentativa antiga: não atribuímos falhas históricas de outro entregador ao atual.

Pedidos do link são contados por criação e exibem situação/venda associada, sem somar novamente o valor como venda. Vendas usam criação; pagamentos, recebimento; financeiro, liquidação/lançamento; pagar/receber, vencimento ou lançamento; cadastros/estoque/frota/terminais são posição atual. Filtros vendedor/categoria/pagamento/situação valem para vendas; entregador vale para entregas/desempenho/auditoria. Cada seção informa sua base temporal. Notificações respeitam o próprio usuário e RLS. Módulos não contratados são identificados como indisponíveis e não consultados no consolidado.

Limites explícitos: período de até 1 ano, 5.000 linhas por modalidade e 20.000 no consolidado. Exceder retorna erro orientando reduzir período/selecionar módulo; nunca retorna silenciosamente apenas parte do resultado. Todas as consultas respeitam tenant/unidade. Exportações selecionam campos explícitos e excluem senhas, chaves de dispositivos, tokens, CSC, certificado privado, XML bruto e coordenadas do coletor. Não há histórico de posições do entregador.

## Validação e publicação

Testes PostgreSQL descartável verificam delegação de cada grupo, perfil sem acesso administrativo, isolamento de unidades, todas as 33 modalidades, venda/pedido sem duplicação, contagem real por entregador, PDF válido e CSV sem campos secretos. Regressões de gestão, fiscal, Meta, bridge, terminais e entregas preservadas. Frontend testa separação das abas e mantém a estrutura Vite integral em PUBLICAR-BANSIR-GAS com assets/ e API AWS. Publicação de frontend requer upload manual e validação das URLs públicas.
