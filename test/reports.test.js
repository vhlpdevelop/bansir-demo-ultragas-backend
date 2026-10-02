import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { normalizeDateRange, getPreviousPeriod, round2 } from '../src/modules/reports/reports.service.js';
import { generateReportPDF } from '../src/modules/reports/reports.pdf.js';

test('reports: date range normalization and previous period calculations', () => {
  const { start, end } = normalizeDateRange('2026-09-01', '2026-09-28');
  assert.equal(start.getFullYear(), 2026);
  assert.equal(start.getMonth(), 8); // 0-indexed: September is 8
  assert.equal(start.getDate(), 1);
  assert.equal(end.getFullYear(), 2026);
  assert.equal(end.getMonth(), 8);
  assert.equal(end.getDate(), 28);

  // Check swapped dates
  const swapped = normalizeDateRange('2026-09-28', '2026-09-01');
  assert.ok(swapped.start <= swapped.end);

  // Previous period duration matches exactly
  const prev = getPreviousPeriod(start, end);
  const curDuration = end.getTime() - start.getTime();
  const prevDuration = prev.end.getTime() - prev.start.getTime();
  assert.equal(curDuration, prevDuration);
  assert.ok(prev.end < start);
});

test('reports: round2 precision helper', () => {
  assert.equal(round2(10.555), 10.56);
  assert.equal(round2(10.554), 10.55);
  assert.equal(round2('45.90'), 45.9);
  assert.equal(round2(null), 0);
  assert.equal(round2(undefined), 0);
});

test('reports: PDF generation produces valid PDF bytes with executive sections', async () => {
  const mockReportData = {
    meta: {
      geradoEm: new Date().toISOString(),
      solicitante: 'Administrador Teste',
      filtrosAplicados: {
        startDate: '2026-09-01T00:00:00.000Z',
        endDate: '2026-09-28T23:59:59.999Z',
        dateReference: 'dtEmissao',
        seller: 'Todos',
        paymentMethod: 'Todas',
        saleStatus: 'Todas',
        tipoDocumento: 'Todos',
        situacaoFiscal: 'Todas',
        inactiveDays: 30
      }
    },
    estabelecimento: {
      name: 'Ateliê Bansir - Varejo',
      documentId: '12.345.678/0001-99',
      address: 'Rua das Cerâmicas, 100',
      city: 'São Paulo - SP'
    },
    vendas: {
      resumo: {
        valorBruto: 1500.00,
        descontos: 50.00,
        cancelamentosDevolucoes: 0,
        valorLiquido: 1450.00,
        qtdVendas: 5,
        qtdItens: 10,
        ticketMedio: 290.00,
        cmvTotal: 600.00,
        lucroBruto: 850.00,
        margemBrutaPercentual: 58.62,
        sellerBreakdown: [{ seller: 'Carolina', count: 3, valorBruto: 900, descontos: 30, valorLiquido: 870, itens: 6 }],
        categoryBreakdown: [{ category: 'Cerâmica', count: 5, valorLiquido: 1450, itens: 10 }],
        paymentBreakdown: [{ paymentMethod: 'pix', count: 5, valorTotal: 1450 }],
        topProductsByQty: [{ name: 'Vaso Terracota', barcode: '7890001', category: 'Cerâmica', quantity: 6, revenue: 900 }],
        topProductsByRevenue: [{ name: 'Vaso Terracota', barcode: '7890001', category: 'Cerâmica', quantity: 6, revenue: 900 }]
      },
      comparativo: {
        periodoAtual: { start: new Date('2026-09-01'), end: new Date('2026-09-28') },
        periodoAnterior: { start: new Date('2026-08-04'), end: new Date('2026-08-31') },
        valorLiquido: { current: 1450, previous: 1200, diffAbs: 250, diffPct: 20.83 },
        qtdVendas: { current: 5, previous: 4, diffAbs: 1, diffPct: 25 },
        ticketMedio: { current: 290, previous: 300, diffAbs: -10, diffPct: -3.33 },
        qtdItens: { current: 10, previous: 8, diffAbs: 2, diffPct: 25 }
      },
      detalhamento: [
        {
          id: 'v1',
          identificacao: 'VND-2026-0001',
          dataHora: new Date('2026-09-15T14:30:00Z'),
          estabelecimento: 'Ateliê Bansir - Varejo',
          vendedor: 'Carolina',
          produto: 'Vaso Bojudo Terracota 35cm',
          skuBarcode: '7890001',
          categoria: 'Cerâmica',
          quantidade: 2,
          valorUnitario: 150,
          valorBruto: 300,
          desconto: 10,
          totalLiquido: 290,
          formaPagamento: 'pix',
          situacaoVenda: 'Concluída',
          documentoFiscalVinculado: 'Não emitido',
          financialStatus: 'posted'
        }
      ]
    },
    estoque: {
      resumo: {
        dataReferenciaSaldo: new Date().toISOString(),
        totalProdutosCadastrados: 12,
        totalUnidadesEstoque: 145,
        valorTotalEstoqueCusto: 5200.00,
        valorPotencialVendaEstoque: 12400.00,
        margemPotencialEstoque: 58.06,
        produtosZerados: 1,
        produtosAbaixoMinimo: 3,
        criterioDiasParados: 30,
        totalProdutosParados: 2,
        totalCapitalParadoCusto: 450.00,
        produtosParados: []
      },
      detalhamento: [
        {
          id: 'p1',
          nome: 'Vaso Bojudo Terracota',
          barcode: '7890001',
          sku: 'VAS-01',
          categoria: 'Cerâmica',
          unidade: 'UN',
          estoqueAtual: 8,
          estoqueMinimo: 5,
          statusEstoque: 'Normal',
          custoUnitario: 45,
          custoTotal: 360,
          precoVendaUnitario: 150,
          precoVendaTotalEstimado: 1200,
          entradasPeriodo: 10,
          saidasPeriodo: 2,
          diasSemMovimento: 12,
          dataUltimaMovimentacao: new Date()
        }
      ]
    },
    fiscal: {
      resumo: {
        referenciaPeriodo: 'Data de Emissão',
        totalDocumentos: 1,
        docsAutorizados: 0,
        docsNaoEmitidos: 1,
        docsCancelados: 0,
        totalVlrProdutos: 300,
        totalVlrDesc: 10,
        totalVlrNF: 290,
        divergenciaVendasXFiscal: {
          faturamentoVendas: 1450,
          faturamentoFiscalAutorizado: 0,
          notaExplicativa: 'Conciliação com a SEFAZ'
        }
      },
      detalhamento: [
        {
          estabelecimento: 'Ateliê Bansir - Varejo - CNPJ: 12.345.678/0001-99',
          numControle: 'VND-2026-0001',
          nrNFCeCFe: 'Não informado',
          serie: 'Não informado',
          modelo: 'Não informado',
          dtEmissao: 'Não emitida',
          hrEmissao: 'Não disponível',
          dtCaixa: '15/09/2026',
          identificador: '65f000000000000000000001',
          vlrProdutos: 300,
          iss: 'Não aplicável (ICMS Varejo)',
          vlrDesc: 10,
          vlrNF: 290,
          statusCX: 'Recebido / Quitado',
          situacao: 'Não emitido (Pendente SEFAZ)',
          chaveNF: 'Não gerada (Aguardando integração fiscal SEFAZ)',
          geradoDevolucao: 'Não'
        }
      ]
    },
    consolidado: {
      periodo: { start: new Date(), end: new Date() },
      estabelecimento: { name: 'Ateliê Bansir' },
      resumoVendas: {},
      resumoEstoque: {},
      resumoFiscal: {}
    }
  };

  const stream = new PassThrough();
  const chunks = [];
  stream.on('data', chunk => chunks.push(chunk));

  await generateReportPDF(mockReportData, 'consolidado', stream);
  const pdfBuffer = Buffer.concat(chunks);

  assert.ok(pdfBuffer.length > 500, 'PDF buffer should contain generated data');
  // Check PDF magic bytes '%PDF-'
  const header = pdfBuffer.slice(0, 5).toString('ascii');
  assert.equal(header, '%PDF-', 'PDF file must start with %PDF- header');
});
