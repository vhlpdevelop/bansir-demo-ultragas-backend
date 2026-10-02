import PDFDocument from 'pdfkit';

/**
 * Format currency in Brazilian Real standard.
 */
function formatBRL(value) {
  const num = Number(value) || 0;
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Format date in Brazilian standard DD/MM/YYYY.
 */
function formatDate(date) {
  if (!date) return 'Não informado';
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);
  return d.toLocaleDateString('pt-BR');
}

/**
 * Generates an executive PDF report and streams it to writableStream (Express `res`).
 */
export async function generateReportPDF(reportData, mode = 'consolidado', writableStream) {
  return new Promise((resolve, reject) => {
    // Landscape is essential for wide tables like fiscal documents and multi-column sales
    const isLandscape = true;
    const doc = new PDFDocument({
      size: 'A4',
      layout: isLandscape ? 'landscape' : 'portrait',
      margin: 36,
      bufferPages: true,
      info: {
        Title: `Relatório Bansir - ${mode.toUpperCase()}`,
        Author: 'Bansir SaaS Varejo',
        Subject: 'Relatório Gerencial de Vendas, Estoque e Documentos Fiscais'
      }
    });

    doc.on('error', reject);
    writableStream.on('finish', resolve);
    writableStream.on('error', reject);

    doc.pipe(writableStream);

    const { meta, estabelecimento, vendas, estoque, fiscal, consolidado } = reportData;
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 36;
    const contentWidth = pageWidth - (margin * 2);

    // Color Palette matching Bansir design tokens
    const cTerracotta = '#C85A32';
    const cDarkEarth = '#231A16';
    const cClayLight = '#F4EEE7';
    const cTextMuted = '#736359';
    const cSage = '#2E7D32';
    const cAmber = '#D97706';
    const cRed = '#DC2626';
    const cBorder = '#E5E7EB';

    // Helper: Draw Header on top of each main section
    function drawReportHeader(titleText, subtitleText) {
      doc.save();
      // Brand Bar
      doc.rect(margin, margin, contentWidth, 54).fill(cDarkEarth);

      // Title & Logo
      doc.fillColor('#FFFFFF').fontSize(16).font('Helvetica-Bold')
        .text('BANSIR', margin + 16, margin + 12);
      doc.fontSize(9).font('Helvetica')
        .fillColor('#E5D5C5')
        .text('Varejo de Artesanato & Gestão Comercial', margin + 16, margin + 32);

      // Store Identification
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#FFFFFF')
        .text(estabelecimento.name || 'Bansir Loja Varejo', margin + 260, margin + 12, { width: 300, align: 'left' });
      doc.fontSize(8).font('Helvetica').fillColor('#D1C7BD')
        .text(`CNPJ: ${estabelecimento.documentId} • ${estabelecimento.city}`, margin + 260, margin + 26)
        .text(`Endereço: ${estabelecimento.address}`, margin + 260, margin + 38);

      // Meta (Date, emission)
      const emissaoStr = new Date(meta.geradoEm).toLocaleString('pt-BR');
      doc.fontSize(8).font('Helvetica').fillColor('#FFFFFF')
        .text(`Emissão: ${emissaoStr}`, margin, margin + 14, { width: contentWidth - 14, align: 'right' });
      doc.fontSize(7).font('Helvetica-Oblique').fillColor('#E5D5C5')
        .text('Relatório Gerencial Interno', margin, margin + 28, { width: contentWidth - 14, align: 'right' });

      doc.restore();

      // Section Banner
      const bannerY = margin + 62;
      doc.rect(margin, bannerY, contentWidth, 24).fill(cTerracotta);
      doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold')
        .text(titleText.toUpperCase(), margin + 12, bannerY + 6);

      // Subtitle / Filters summary
      doc.fillColor(cTextMuted).fontSize(8).font('Helvetica')
        .text(`Período de Apuração: ${formatDate(meta.filtrosAplicados.startDate)} até ${formatDate(meta.filtrosAplicados.endDate)} • Filtros: Vendedor: ${meta.filtrosAplicados.seller} | Pgto: ${meta.filtrosAplicados.paymentMethod} | Ref: ${meta.filtrosAplicados.dateReference}`, margin, bannerY + 28);

      return bannerY + 44;
    }

    // Helper: Draw KPI Box
    function drawKpiBox(x, y, w, h, label, value, subtext = '', valColor = cDarkEarth) {
      doc.save();
      doc.roundedRect(x, y, w, h, 4).fillAndStroke(cClayLight, cBorder);
      doc.fillColor(cTextMuted).fontSize(7).font('Helvetica-Bold')
        .text(label.toUpperCase(), x + 8, y + 8, { width: w - 16 });
      doc.fillColor(valColor).fontSize(12).font('Helvetica-Bold')
        .text(value, x + 8, y + 20, { width: w - 16 });
      if (subtext) {
        doc.fillColor(cTextMuted).fontSize(6.5).font('Helvetica')
          .text(subtext, x + 8, y + 36, { width: w - 16 });
      }
      doc.restore();
    }

    // ==========================================
    // SECTION: RESUMO EXECUTIVO (CONSOLIDADO / VENDAS)
    // ==========================================
    if (mode === 'consolidado' || mode === 'vendas') {
      let currentY = drawReportHeader(
        mode === 'consolidado' ? 'Relatório Consolidado Gerencial' : 'Relatório Analítico de Vendas',
        'Demonstrativo de Faturamento, Margens e Indicadores Comerciais'
      );

      // 4 KPIs Cards in a row
      const boxW = (contentWidth - 24) / 4;
      const boxH = 46;
      drawKpiBox(margin, currentY, boxW, boxH, 'Valor Bruto', formatBRL(vendas.resumo.valorBruto), 'Total antes de descontos');
      drawKpiBox(margin + boxW + 8, currentY, boxW, boxH, 'Descontos Concedidos', formatBRL(vendas.resumo.descontos), 'Total abatido', cRed);
      drawKpiBox(margin + (boxW + 8) * 2, currentY, boxW, boxH, 'Valor Líquido Vendas', formatBRL(vendas.resumo.valorLiquido), `${vendas.resumo.qtdVendas} pedidos concluídos`, cSage);
      drawKpiBox(margin + (boxW + 8) * 3, currentY, boxW, boxH, 'Ticket Médio', formatBRL(vendas.resumo.ticketMedio), `${vendas.resumo.qtdItens} itens vendidos`);

      currentY += boxH + 12;

      // Commercial Margins & Previous Period Comparison Box
      const compBoxW = (contentWidth - 10) / 2;
      const compBoxH = 68;

      // Margins Box
      doc.save();
      doc.roundedRect(margin, currentY, compBoxW, compBoxH, 4).fillAndStroke('#FAFAFA', cBorder);
      doc.fillColor(cDarkEarth).fontSize(8.5).font('Helvetica-Bold')
        .text('CUSTO MERCADORIAS VENDIDAS & MARGEM BRUTA', margin + 10, currentY + 8);
      doc.fillColor(cTextMuted).fontSize(7.5).font('Helvetica')
        .text(`CMV Estimado (Custo de Reposição): ${formatBRL(vendas.resumo.cmvTotal)}`, margin + 10, currentY + 22)
        .text(`Lucro Bruto Comercial: ${formatBRL(vendas.resumo.lucroBruto)}`, margin + 10, currentY + 34)
        .text(`Margem Bruta sobre Faturamento: ${vendas.resumo.margemBrutaPercentual}%`, margin + 10, currentY + 46)
        .fillColor(cRed)
        .text('* Nota: O Lucro Bruto não reflete despesas fixas (aluguel, salários fixos, etc.).', margin + 10, currentY + 57);
      doc.restore();

      // Comparison Box
      doc.save();
      doc.roundedRect(margin + compBoxW + 10, currentY, compBoxW, compBoxH, 4).fillAndStroke('#FAFAFA', cBorder);
      doc.fillColor(cDarkEarth).fontSize(8.5).font('Helvetica-Bold')
        .text('COMPARAÇÃO COM PERÍODO ANTERIOR EQUIVALENTE', margin + compBoxW + 20, currentY + 8);
      
      const comp = vendas.comparativo;
      const diffFmt = (compItem) => {
        const signal = compItem.diffAbs >= 0 ? '+' : '';
        return `${signal}${formatBRL(compItem.diffAbs)} (${signal}${compItem.diffPct}%)`;
      };
      doc.fillColor(cTextMuted).fontSize(7.5).font('Helvetica')
        .text(`Período Anterior: ${formatDate(comp.periodoAnterior.start)} a ${formatDate(comp.periodoAnterior.end)}`, margin + compBoxW + 20, currentY + 22)
        .text(`Variação Faturamento Líquido: ${diffFmt(comp.valorLiquido)}`, margin + compBoxW + 20, currentY + 34)
        .text(`Variação Volume de Pedidos: ${comp.qtdVendas.diffAbs >= 0 ? '+' : ''}${comp.qtdVendas.diffAbs} vendas (${comp.qtdVendas.diffPct}%)`, margin + compBoxW + 20, currentY + 46)
        .text(`Variação Ticket Médio: ${diffFmt(comp.ticketMedio)}`, margin + compBoxW + 20, currentY + 57);
      doc.restore();

      currentY += compBoxH + 16;

      // Table of Sales Detail
      doc.fontSize(9.5).font('Helvetica-Bold').fillColor(cDarkEarth)
        .text('DETALHAMENTO DE VENDAS NO PERÍODO', margin, currentY);
      currentY += 14;

      const salesCols = [
        { label: 'Cód. Venda', width: 85, align: 'left' },
        { label: 'Data/Hora', width: 75, align: 'left' },
        { label: 'Vendedor', width: 85, align: 'left' },
        { label: 'Produto Artesanal', width: 175, align: 'left' },
        { label: 'Qtd', width: 30, align: 'center' },
        { label: 'Unitário', width: 60, align: 'right' },
        { label: 'Bruto', width: 60, align: 'right' },
        { label: 'Desconto', width: 55, align: 'right' },
        { label: 'Líquido', width: 65, align: 'right' },
        { label: 'Pgto', width: 45, align: 'center' },
        { label: 'Doc. Fiscal', width: 65, align: 'center' }
      ];

      function drawSalesTableHeader(yPos) {
        doc.rect(margin, yPos, contentWidth, 16).fill(cDarkEarth);
        let curX = margin + 4;
        doc.font('Helvetica-Bold').fontSize(7).fillColor('#FFFFFF');
        salesCols.forEach(col => {
          doc.text(col.label, curX, yPos + 4, { width: col.width - 6, align: col.align });
          curX += col.width;
        });
        return yPos + 18;
      }

      currentY = drawSalesTableHeader(currentY);

      vendas.detalhamento.forEach((v, idx) => {
        // Page break check
        if (currentY > pageHeight - 50) {
          doc.addPage({ layout: 'landscape', margin });
          currentY = drawSalesTableHeader(margin + 10);
        }

        const bg = idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB';
        doc.rect(margin, currentY, contentWidth, 14).fill(bg);

        let curX = margin + 4;
        doc.font('Helvetica').fontSize(6.8).fillColor(cDarkEarth);
        
        doc.text(v.identificacao, curX, currentY + 3, { width: salesCols[0].width - 6, align: salesCols[0].align });
        curX += salesCols[0].width;

        const dtStr = new Date(v.dataHora).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
        doc.text(dtStr, curX, currentY + 3, { width: salesCols[1].width - 6, align: salesCols[1].align });
        curX += salesCols[1].width;

        doc.text(v.vendedor, curX, currentY + 3, { width: salesCols[2].width - 6, align: salesCols[2].align });
        curX += salesCols[2].width;

        doc.text(v.produto, curX, currentY + 3, { width: salesCols[3].width - 6, align: salesCols[3].align, ellipsis: true });
        curX += salesCols[3].width;

        doc.text(String(v.quantidade), curX, currentY + 3, { width: salesCols[4].width - 6, align: salesCols[4].align });
        curX += salesCols[4].width;

        doc.text(formatBRL(v.valorUnitario), curX, currentY + 3, { width: salesCols[5].width - 6, align: salesCols[5].align });
        curX += salesCols[5].width;

        doc.text(formatBRL(v.valorBruto), curX, currentY + 3, { width: salesCols[6].width - 6, align: salesCols[6].align });
        curX += salesCols[6].width;

        doc.fillColor(v.desconto > 0 ? cRed : cTextMuted)
          .text(v.desconto > 0 ? `-${formatBRL(v.desconto)}` : 'R$ 0,00', curX, currentY + 3, { width: salesCols[7].width - 6, align: salesCols[7].align });
        curX += salesCols[7].width;

        doc.fillColor(cSage).font('Helvetica-Bold')
          .text(formatBRL(v.totalLiquido), curX, currentY + 3, { width: salesCols[8].width - 6, align: salesCols[8].align });
        curX += salesCols[8].width;

        doc.fillColor(cDarkEarth).font('Helvetica')
          .text(v.formaPagamento.toUpperCase(), curX, currentY + 3, { width: salesCols[9].width - 6, align: salesCols[9].align });
        curX += salesCols[9].width;

        doc.text(v.documentoFiscalVinculado, curX, currentY + 3, { width: salesCols[10].width - 6, align: salesCols[10].align, ellipsis: true });

        currentY += 15;
      });

      // Total row
      doc.rect(margin, currentY, contentWidth, 16).fill(cClayLight);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(cDarkEarth)
        .text('TOTAIS DE VENDAS', margin + 12, currentY + 4);
      doc.text(formatBRL(vendas.resumo.valorBruto), margin + 355 + 60, currentY + 4, { width: 55, align: 'right' });
      doc.fillColor(cRed).text(`-${formatBRL(vendas.resumo.descontos)}`, margin + 355 + 120, currentY + 4, { width: 55, align: 'right' });
      doc.fillColor(cSage).text(formatBRL(vendas.resumo.valorLiquido), margin + 355 + 175, currentY + 4, { width: 65, align: 'right' });
      currentY += 24;
    }

    // ==========================================
    // SECTION: ESTOQUE (STOCK REPORT)
    // ==========================================
    if (mode === 'consolidado' || mode === 'estoque') {
      if (mode === 'consolidado') {
        doc.addPage({ layout: 'landscape', margin });
      }

      let currentY = drawReportHeader(
        'Relatório de Estoque e Posição Física',
        'Inventário a Custo, Projeção de Faturamento e Produtos com Alerta'
      );

      const boxW = (contentWidth - 24) / 4;
      const boxH = 46;
      drawKpiBox(margin, currentY, boxW, boxH, 'Total em Estoque', `${estoque.resumo.totalUnidadesEstoque} peças`, `${estoque.resumo.totalProdutosCadastrados} itens cadastrados`);
      drawKpiBox(margin + boxW + 8, currentY, boxW, boxH, 'Valor a Custo', formatBRL(estoque.resumo.valorTotalEstoqueCusto), 'Custo total de reposição');
      drawKpiBox(margin + (boxW + 8) * 2, currentY, boxW, boxH, 'Potencial de Venda', formatBRL(estoque.resumo.valorPotencialVendaEstoque), 'Estimativa a preço de varejo', cSage);
      drawKpiBox(margin + (boxW + 8) * 3, currentY, boxW, boxH, 'Capital Parado (>30d)', formatBRL(estoque.resumo.totalCapitalParadoCusto), `${estoque.resumo.totalProdutosParados} produtos sem giro`, cAmber);

      currentY += boxH + 14;

      doc.fontSize(9.5).font('Helvetica-Bold').fillColor(cDarkEarth)
        .text('POSIÇÃO DETALHADA DE ESTOQUE', margin, currentY);
      currentY += 14;

      const stockCols = [
        { label: 'Produto', width: 220, align: 'left' },
        { label: 'Código Barras', width: 90, align: 'left' },
        { label: 'Categoria', width: 85, align: 'left' },
        { label: 'Un', width: 25, align: 'center' },
        { label: 'Saldo', width: 40, align: 'center' },
        { label: 'Min', width: 35, align: 'center' },
        { label: 'Status', width: 70, align: 'center' },
        { label: 'Custo Unit.', width: 60, align: 'right' },
        { label: 'Custo Total', width: 70, align: 'right' },
        { label: 'Preço Varejo', width: 65, align: 'right' }
      ];

      function drawStockTableHeader(yPos) {
        doc.rect(margin, yPos, contentWidth, 16).fill(cDarkEarth);
        let curX = margin + 4;
        doc.font('Helvetica-Bold').fontSize(7).fillColor('#FFFFFF');
        stockCols.forEach(col => {
          doc.text(col.label, curX, yPos + 4, { width: col.width - 6, align: col.align });
          curX += col.width;
        });
        return yPos + 18;
      }

      currentY = drawStockTableHeader(currentY);

      estoque.detalhamento.forEach((p, idx) => {
        if (currentY > pageHeight - 50) {
          doc.addPage({ layout: 'landscape', margin });
          currentY = drawStockTableHeader(margin + 10);
        }

        const bg = idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB';
        doc.rect(margin, currentY, contentWidth, 14).fill(bg);

        let curX = margin + 4;
        doc.font('Helvetica').fontSize(6.8).fillColor(cDarkEarth);

        doc.text(p.nome, curX, currentY + 3, { width: stockCols[0].width - 6, align: stockCols[0].align, ellipsis: true });
        curX += stockCols[0].width;

        doc.text(p.barcode, curX, currentY + 3, { width: stockCols[1].width - 6, align: stockCols[1].align });
        curX += stockCols[1].width;

        doc.text(p.categoria, curX, currentY + 3, { width: stockCols[2].width - 6, align: stockCols[2].align });
        curX += stockCols[2].width;

        doc.text(p.unidade, curX, currentY + 3, { width: stockCols[3].width - 6, align: stockCols[3].align });
        curX += stockCols[3].width;

        doc.font('Helvetica-Bold').text(String(p.estoqueAtual), curX, currentY + 3, { width: stockCols[4].width - 6, align: stockCols[4].align });
        curX += stockCols[4].width;

        doc.font('Helvetica').text(String(p.estoqueMinimo), curX, currentY + 3, { width: stockCols[5].width - 6, align: stockCols[5].align });
        curX += stockCols[5].width;

        const statColor = p.estoqueAtual === 0 ? cRed : p.estoqueAtual <= p.estoqueMinimo ? cAmber : cSage;
        doc.fillColor(statColor).font('Helvetica-Bold').text(p.statusEstoque, curX, currentY + 3, { width: stockCols[6].width - 6, align: stockCols[6].align });
        curX += stockCols[6].width;

        doc.fillColor(cDarkEarth).font('Helvetica').text(formatBRL(p.custoUnitario), curX, currentY + 3, { width: stockCols[7].width - 6, align: stockCols[7].align });
        curX += stockCols[7].width;

        doc.text(formatBRL(p.custoTotal), curX, currentY + 3, { width: stockCols[8].width - 6, align: stockCols[8].align });
        curX += stockCols[8].width;

        doc.text(formatBRL(p.precoVendaUnitario), curX, currentY + 3, { width: stockCols[9].width - 6, align: stockCols[9].align });

        currentY += 15;
      });

      // Total row
      doc.rect(margin, currentY, contentWidth, 16).fill(cClayLight);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(cDarkEarth)
        .text('TOTAIS DE ESTOQUE', margin + 12, currentY + 4);
      doc.text(`${estoque.resumo.totalUnidadesEstoque} unidades`, margin + 370, currentY + 4, { width: 80, align: 'center' });
      doc.text(formatBRL(estoque.resumo.valorTotalEstoqueCusto), margin + 560, currentY + 4, { width: 75, align: 'right' });
      doc.text(formatBRL(estoque.resumo.valorPotencialVendaEstoque), margin + 645, currentY + 4, { width: 75, align: 'right' });
      currentY += 24;
    }

    // ==========================================
    // SECTION: DOCUMENTOS FISCAIS (MANDATORY STRICT COLUMNS)
    // ==========================================
    if (mode === 'consolidado' || mode === 'fiscal') {
      if (mode === 'consolidado') {
        doc.addPage({ layout: 'landscape', margin });
      }

      let currentY = drawReportHeader(
        'Relatório de Documentos Fiscais',
        'Controle de Emissão, Situação Fiscal e Conciliação com Caixa'
      );

      const boxW = (contentWidth - 24) / 4;
      const boxH = 46;
      drawKpiBox(margin, currentY, boxW, boxH, 'Total Documentos', `${fiscal.resumo.totalDocumentos} registros`, 'Operações no período');
      drawKpiBox(margin + boxW + 8, currentY, boxW, boxH, 'Documentos Autorizados', `${fiscal.resumo.docsAutorizados} autorizados`, 'Homologados SEFAZ', cSage);
      drawKpiBox(margin + (boxW + 8) * 2, currentY, boxW, boxH, 'Pendentes / Não Emitidos', `${fiscal.resumo.docsNaoEmitidos} pendentes`, 'Sem emissão fiscal real', cAmber);
      drawKpiBox(margin + (boxW + 8) * 3, currentY, boxW, boxH, 'Valor Total Fiscal', formatBRL(fiscal.resumo.totalVlrNF), 'Faturamento correspondente');

      currentY += boxH + 12;

      // Divergence note
      doc.save();
      doc.roundedRect(margin, currentY, contentWidth, 28, 4).fillAndStroke('#FFFBEB', '#FDE68A');
      doc.fillColor('#92400E').fontSize(7.5).font('Helvetica-Bold')
        .text('AVISO LEGAL E CONCILIAÇÃO:', margin + 8, currentY + 6);
      doc.fillColor('#78350F').fontSize(7).font('Helvetica')
        .text(fiscal.resumo.divergenciaVendasXFiscal.notaExplicativa, margin + 8, currentY + 16, { width: contentWidth - 16 });
      doc.restore();

      currentY += 34;

      doc.fontSize(9.5).font('Helvetica-Bold').fillColor(cDarkEarth)
        .text('QUADRO DETALHADO DE DOCUMENTOS FISCAIS (CAMPOS OFICIAIS)', margin, currentY);
      currentY += 14;

      // EXACT MANDATORY COLUMNS REQUESTED BY USER:
      // Estabelecimento | Num. Controle | Nr NFCe/CFe | Série | Modelo | Dt Emissão | Hr Emissão | Dt Caixa | Identificador | Vlr Produtos | Iss | Vlr Desc | Vlr NF | Status CX | Situação | Chave NF | Gerado devolucao
      const fiscalCols = [
        { label: 'Estabelecimento', width: 75, align: 'left' },
        { label: 'Num. Controle', width: 60, align: 'left' },
        { label: 'Nr NFCe/CFe', width: 50, align: 'left' },
        { label: 'Série', width: 25, align: 'center' },
        { label: 'Modelo', width: 45, align: 'center' },
        { label: 'Dt Emissão', width: 45, align: 'center' },
        { label: 'Hr Emissão', width: 45, align: 'center' },
        { label: 'Dt Caixa', width: 45, align: 'center' },
        { label: 'Identificador', width: 55, align: 'left' },
        { label: 'Vlr Produtos', width: 45, align: 'right' },
        { label: 'Iss', width: 35, align: 'center' },
        { label: 'Vlr Desc', width: 40, align: 'right' },
        { label: 'Vlr NF', width: 45, align: 'right' },
        { label: 'Status CX', width: 50, align: 'center' },
        { label: 'Situação', width: 55, align: 'center' },
        { label: 'Chave NF', width: 100, align: 'left' },
        { label: 'Gerado devolucao', width: 45, align: 'center' }
      ];

      function drawFiscalTableHeader(yPos) {
        doc.rect(margin, yPos, contentWidth, 16).fill(cDarkEarth);
        let curX = margin + 2;
        doc.font('Helvetica-Bold').fontSize(6.2).fillColor('#FFFFFF');
        fiscalCols.forEach(col => {
          doc.text(col.label, curX, yPos + 4, { width: col.width - 4, align: col.align });
          curX += col.width;
        });
        return yPos + 18;
      }

      currentY = drawFiscalTableHeader(currentY);

      fiscal.detalhamento.forEach((d, idx) => {
        if (currentY > pageHeight - 50) {
          doc.addPage({ layout: 'landscape', margin });
          currentY = drawFiscalTableHeader(margin + 10);
        }

        const bg = idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB';
        doc.rect(margin, currentY, contentWidth, 14).fill(bg);

        let curX = margin + 2;
        doc.font('Helvetica').fontSize(5.8).fillColor(cDarkEarth);

        doc.text(d.estabelecimento, curX, currentY + 3, { width: fiscalCols[0].width - 4, align: fiscalCols[0].align, ellipsis: true });
        curX += fiscalCols[0].width;

        doc.text(d.numControle, curX, currentY + 3, { width: fiscalCols[1].width - 4, align: fiscalCols[1].align, ellipsis: true });
        curX += fiscalCols[1].width;

        doc.text(d.nrNFCeCFe, curX, currentY + 3, { width: fiscalCols[2].width - 4, align: fiscalCols[2].align });
        curX += fiscalCols[2].width;

        doc.text(d.serie, curX, currentY + 3, { width: fiscalCols[3].width - 4, align: fiscalCols[3].align });
        curX += fiscalCols[3].width;

        doc.text(d.modelo, curX, currentY + 3, { width: fiscalCols[4].width - 4, align: fiscalCols[4].align });
        curX += fiscalCols[4].width;

        doc.text(d.dtEmissao, curX, currentY + 3, { width: fiscalCols[5].width - 4, align: fiscalCols[5].align });
        curX += fiscalCols[5].width;

        doc.text(d.hrEmissao, curX, currentY + 3, { width: fiscalCols[6].width - 4, align: fiscalCols[6].align });
        curX += fiscalCols[6].width;

        doc.text(d.dtCaixa, curX, currentY + 3, { width: fiscalCols[7].width - 4, align: fiscalCols[7].align });
        curX += fiscalCols[7].width;

        doc.text(d.identificador.slice(-8), curX, currentY + 3, { width: fiscalCols[8].width - 4, align: fiscalCols[8].align });
        curX += fiscalCols[8].width;

        doc.text(formatBRL(d.vlrProdutos), curX, currentY + 3, { width: fiscalCols[9].width - 4, align: fiscalCols[9].align });
        curX += fiscalCols[9].width;

        doc.text(d.iss === 'Não aplicável (ICMS Varejo)' ? 'N/A' : d.iss, curX, currentY + 3, { width: fiscalCols[10].width - 4, align: fiscalCols[10].align });
        curX += fiscalCols[10].width;

        doc.text(formatBRL(d.vlrDesc), curX, currentY + 3, { width: fiscalCols[11].width - 4, align: fiscalCols[11].align });
        curX += fiscalCols[11].width;

        doc.font('Helvetica-Bold').text(formatBRL(d.vlrNF), curX, currentY + 3, { width: fiscalCols[12].width - 4, align: fiscalCols[12].align });
        curX += fiscalCols[12].width;

        doc.font('Helvetica').text(d.statusCX, curX, currentY + 3, { width: fiscalCols[13].width - 4, align: fiscalCols[13].align });
        curX += fiscalCols[13].width;

        doc.text(d.situacao, curX, currentY + 3, { width: fiscalCols[14].width - 4, align: fiscalCols[14].align, ellipsis: true });
        curX += fiscalCols[14].width;

        doc.text(d.chaveNF, curX, currentY + 3, { width: fiscalCols[15].width - 4, align: fiscalCols[15].align, ellipsis: true });
        curX += fiscalCols[15].width;

        doc.text(d.geradoDevolucao, curX, currentY + 3, { width: fiscalCols[16].width - 4, align: fiscalCols[16].align });

        currentY += 15;
      });

      // Total row
      doc.rect(margin, currentY, contentWidth, 16).fill(cClayLight);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(cDarkEarth)
        .text('TOTAIS FISCAIS', margin + 12, currentY + 4);
      doc.text(formatBRL(fiscal.resumo.totalVlrProdutos), margin + 400, currentY + 4, { width: 50, align: 'right' });
      doc.text(formatBRL(fiscal.resumo.totalVlrDesc), margin + 475, currentY + 4, { width: 50, align: 'right' });
      doc.text(formatBRL(fiscal.resumo.totalVlrNF), margin + 520, currentY + 4, { width: 55, align: 'right' });
      currentY += 24;
    }

    // ==========================================
    // FOOTER PAGINATION ON ALL PAGES
    // ==========================================
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.save();
      doc.strokeColor(cBorder).lineWidth(0.5)
        .moveTo(margin, pageHeight - 24)
        .lineTo(pageWidth - margin, pageHeight - 24)
        .stroke();

      doc.fillColor(cTextMuted).fontSize(7).font('Helvetica')
        .text('Bansir SaaS Varejo de Artesanato • Relatório de Gestão Comercial e Fiscal', margin, pageHeight - 18, { align: 'left' });
      doc.text(`Página ${i + 1} de ${range.count}`, margin, pageHeight - 18, { width: contentWidth, align: 'right' });
      doc.restore();
    }

    doc.end();
  });
}
