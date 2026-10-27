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
