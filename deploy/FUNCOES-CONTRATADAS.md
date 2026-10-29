# Liberações contratuais — etapa 2

Migração 030 e código features.js aplicam as três funções por empresa, para todas as unidades. Empresas sem contrato cadastrado preservam as funções existentes; contratos já gravados passam a respeitar os valores salvos.

WhatsApp desligado bloqueia APIs de configuração/envio, novos eventos de entrada, agendamento e execução de envios. A conexão Meta existente permanece cadastrada. Link desligado bloqueia catálogo, início e criação/consulta pública de pedidos, e APIs administrativas do link. Saudação automática com link não é enviada enquanto o link estiver desativado. Inteligência desligada bloqueia consulta, edição e aplicação de preços sugeridos; financeiro básico continua disponível. A revogação vale para novas requisições e verificações do worker; uma chamada externa que já começou pode concluir.

Frontend oculta Página de pedidos/Pedidos do link, Inteligência & Markup e aba WhatsApp, respeitando também RBAC. Sessões abertas consultam o perfil a cada 15 segundos e ao voltar à janela. Mesmo durante falha de rede, o backend mantém o bloqueio.

Publicação: após backup, construir imagem, aplicar migrações com login temporário do migrador e voltar a NOLOGIN. Recriar API e whatsapp; outros workers não precisam mudar. No S3, subir o conteúdo de bansir-gas-funcoes-contratadas-frontend.zip, preservando assets/. Subir assets antes de index.html e invalidar /* no CloudFront. Não remover assets antigos durante a publicação.

Validação: testes de contratos, pedidos públicos e Meta em PostgreSQL descartável; build com VITE_API_URL AWS. Testes não alteram contratos em produção nem enviam mensagens reais.
