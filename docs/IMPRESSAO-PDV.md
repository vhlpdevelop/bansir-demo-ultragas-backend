# Impressão no PDV PostgreSQL

Abra uma venda em Vendas e recebimentos e abra o comprovante. O painel Impressão permite papel 58/80 mm, PDF no navegador e impressão direta via QZ Tray. O recibo é sempre sem valor fiscal. DANFE só é gerado a partir do XML autorizado, com chave/ambiente/modelo/protocolo correspondentes e QR Code presente; não depende do cadastro atual do emitente. A geração não emite nem reenvia a NFC-e.

## Instalação no caixa

1. Identificar marca/modelo e largura do papel. Zebra de etiquetas não é equivalente a Epson de recibos. Não foi realizado teste em equipamento físico.
2. Conectar USB e instalar driver oficial compatível com impressão PDF/gráfica (por exemplo ZDesigner quando suportado). Drivers somente texto/ZPL não atendem a este caminho. Configurar bobina contínua e largura correta.
3. Testar impressão pelo Windows. Instalar QZ Tray de https://qz.io/download/ e mantê-lo aberto para impressão direta.
4. Abrir comprovante no Bansir, escolher 58 ou 80 mm, clicar Conectar QZ/listar impressoras, autorizar acesso e selecionar o equipamento. Preferência é local por computador/navegador.
5. Abrir recibo PDF para conferir antes de usar Recibo na impressora. Para imprimir no navegador, usar tamanho real/100%, largura de papel correta, sem ajustar à página.
6. Após autorização da nota e disponibilidade do XML, usar Abrir DANFE NFC-e ou NFC-e na impressora. Uma NFC-e ainda pendente ou rejeitada não pode gerar DANFE autorizado. Homologação fica identificada sem valor fiscal.

Sem QZ, o PDF continua disponível para impressão pelo navegador. Não há instalação automática ou assinatura de confiança provisionada: QZ pode solicitar autorizações. Impressão silenciosa exige configuração de certificado/assinatura separada. A aplicação não pede para desabilitar verificações.

Envio à fila não comprova saída física. Conferir papel/fila antes de repetir; nunca refazer a venda por falha de impressão. Impressão automática após vender não foi habilitada.

Validação: PDFs reais com 58 e 80 mm, autorização/QR obrigatórios, layout renderizado e testes HTTP de acesso por estabelecimento e largura inválida. Suítes PDV e pedidos passaram. XML fiscal de sucesso é sintético, não representa emissão real ou homologação do equipamento. O ambiente fiscal real continua com os requisitos operacionais anteriormente documentados.

## Atualização: modo automático e assinatura

Botão Impressão: manual/automática no PDV e comprovante, salvo por navegador/computador. Padrão manual. Para ativar automático, selecionar impressora e configurar assinatura QZ válida no servidor. Disparo apenas para a venda recém-registrada no caixa atual; recibo inicial e DANFE quando autorizado enquanto o comprovante estiver aberto. Histórico não imprime sozinho. Tentativas são marcadas antes do envio, serializadas e protegidas por Web Locks quando disponíveis. Falhas/incerteza exigem conferência e reimpressão manual. Não altera venda/pagamento nem reenvia emissão.

Servidor: QZ_SIGNING_CERTIFICATE_BASE64 e QZ_SIGNING_PRIVATE_KEY_BASE64, chave RSA >=2048 bits e certificado correspondente dentro da validade. Arquivos/variáveis reais somente no ambiente privado da API. A chave de assinatura nunca vai ao navegador ou ao bucket do app. Não usar o A1 fiscal para este fim.

A API assina SHA512 do resumo SHA256 usado pelo QZ 2.x, verificando mensagem original, carimbo de tempo, comandos permitidos e documento PDF previamente gerado para o mesmo usuário/empresa/estabelecimento (validade cinco minutos). Não é um assinador genérico de comandos QZ: impressão raw, arquivos, conexões arbitrárias e documentos não liberados são recusados. Cache de liberação é local à instância da API; múltiplas instâncias exigem armazenamento compartilhado/afinidade antes de escalar.

Retirada dos avisos depende de certificado oficial QZ ou raiz própria instalada como confiança nos caixas. O dono escolheu raiz própria. Raiz e certificado de assinatura foram gerados na EC2; assinatura RSA-SHA512 real validada e API configurada. Falta executar o pacote de confiança no computador do caixa. Nenhuma compra de certificado oficial foi realizada. Até a instalação no cliente, o QZ pode pedir autorização. O navegador ainda pode solicitar permissão de rede local uma vez; o app não pode suprimir essa decisão.

Referências: https://qz.io/docs/signing e https://qz.io/docs/faq . A escolha de certificado é independente de automático/manual. Modo manual significa clique do operador; envio direto assinado pelo QZ pode ser usado nos dois modos.

### Pacote de confiança próprio

Pacote privado de entrega `bansir-qz-caixa.zip`: certificados públicos e instaladores gerados dos templates em deploy/qz. Os placeholders de SHA256 precisam ser substituídos pelos hashes dos certificados ao empacotar; não executar os templates diretamente. O pacote não contém chave privada. Chaves persistem em /etc/bansir/qz-signing (root 0700/0600) e a chave de assinatura é configurada somente no deploy/api.env privado. Backup de banco não substitui backup privado dessas chaves/configuração; preservar em cofre administrativo. Certificado de assinatura válido até 27/10/2027; renovar antes disso, reconfigurar a API, atualizar confiança e recarregar o navegador. Raiz válida por dez anos.

O instalador Windows pede elevação para copiar override.crt ao diretório padrão do QZ e cadastrar o certificado Bansir com --allow. Preserva entradas existentes na lista compartilhada e copia apenas a entrada correspondente ao certificado Bansir. Recusa substituir uma raiz personalizada diferente; nenhum certificado da loja é instalado no repositório geral de raízes do Windows. Reabrir QZ sem elevação após terminar. Sintaxe PowerShell validada; não foi executado neste computador nem no caixa real.
