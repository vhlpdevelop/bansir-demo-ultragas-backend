# Terminais e adquirentes

Cada terminal mantém um navegador e até uma maquininha por provider: pagbank, mercadopago, caixa. Caixa e vendas continuam associados ao mesmo terminal_id. O header X-Pdv-Terminal continua aceitando pdvt_ e o servidor armazena somente SHA256 dessa credencial aleatória.

POST /pdv/terminals/pair recebe code, clientType (browser padrão), provider opcional. smartpos sem provider assume pagbank. Repareamento substitui apenas esse cliente/provider. GET /pdv/terminals retorna smartpos:[{provider,paired_at,last_seen_at}], smartpos_paired e os erros de vínculo no contrato anterior. Não retorna diagnósticos, hashes ou tokens nas listagens.

DELETE /pdv/terminals/:id/smartpos/:provider exige admin/superadmin. Desativar terminal revoga todos os clientes e exige caixa fechado. Auditoria identifica provider/client_type; falhas sem terminal conhecido usam terminal_id nulo e nunca armazenam o código tentado.

Ativação gera 6 dígitos com crypto.randomInt e validade 10 minutos/uso único. HMAC-SHA256 usa o segredo JWT do servidor, com separação de domínio, tenant e estabelecimento. A consulta e unicidade também são limitadas explicitamente à unidade autenticada. O formato 24 hex ainda é aceito, mas requer HMAC: códigos pendentes SHA256 anteriores à migração são invalidados e precisam ser gerados novamente. Credenciais de navegador/SmartPOS já pareadas são preservadas; hashes SmartPOS antigos migram para pagbank. A coluna smartpos_hash antiga não é usada para autenticação.

Cinco erros por usuário ou por unidade bloqueiam por 15 minutos completos (429 RATE_LIMITED, Retry-After). Contadores e auditoria são persistidos na mesma transação que devolve o erro, com commit antes da resposta HTTP. Reiniciar a API não zera bloqueios. Há também limite adicional por IP. Troca de código/terminal não contorna o bloqueio. Tentativas bloqueadas não prolongam indefinidamente o prazo.

POST heartbeat atualiza diagnóstico exclusivamente na linha identificada pelo token; acquirerProvider informado não seleciona nem transfere a credencial. Qualquer uso autenticado da maquininha atualiza seu last_seen_at. capabilities mantém version:1 e acrescenta providers e activationCodeLength:6.

## Publicação coordenada

Primeiro publicar o frontend PUBLICAR-BANSIR-GAS (aceita 6 e 24 caracteres, compatível com API antiga). Depois aplicar migração046 e publicar a API. Frontend antigo possui validação local de 24 caracteres e não aceita digitar 6; aceitar os dois formatos no backend não resolve essa limitação da tela publicada. APK atual continua com provider pagbank padrão, mas sua UI deve também aceitar os novos 6 dígitos; contrato da API não garante que validações locais do APK aceitem esse tamanho. Não alterar bansir-terminal neste trabalho.

Migração copia vínculos antigos verificando contagem, restaura FORCE RLS ao final da transação e não altera caixas/vendas/turnos. Na implantação, usar backup, migrador temporariamente habilitado e NOLOGIN ao terminar. API ainda não deve ser publicada antes do frontend compatível estar no S3.
