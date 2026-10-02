import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { protect } from '../../middlewares/auth.middleware.js';
import { Operation, present } from './operation.model.js';
import { readiness, createOperation, getOperation, scope, queueAction, getDraft, saveDraft, isAdmin } from './operation.service.js';
import { fail } from './operation.policy.js';

const router = Router();
const route = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (error) { if (!res.headersSent) res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Não foi possível concluir a operação. Atualize o painel e consulte o estado.' }); }
};

// Notifications are hints only: no value/status from this unauthenticated body is trusted.
// Atomic debounce limits each known order to one scheduled GET per minute.
router.post('/cielo/notifications', route(async (req, res) => {
  const id = req.body.order_id || req.body.id;
  if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) return res.sendStatus(202);
  await Operation.updateOne({ providerOrderId: id, mode: 'homologation', busy: false, job: null,
    $or: [{ nextPollAt: { $lte: new Date() } }, { nextPollAt: null }] },
  { $set: { job: 'reconcile', nextPollAt: new Date(Date.now() + 60000) } });
  res.sendStatus(202);
}));
router.use(protect);
router.use((req, res, next) => {
  const user = req.user;
  if (isAdmin(user) || user.role === 'operador' || user.allowedRoutes?.some(r => ['sales', 'operations'].includes(r))) return next();
  res.status(403).json({ success: false, message: 'Acesso ao caixa necessário.' });
});
router.get('/readiness', route(async (req, res) => res.json({ success: true, data: { ...readiness(), canConfigure: isAdmin(req.user) } })));
router.get('/', route(async (req, res) => {
  const page = Math.max(0, Math.min(10000, Number.parseInt(req.query.page, 10) || 0));
  const filter = scope(req.user);
  const [items, total] = await Promise.all([Operation.find(filter).sort({ createdAt: -1 }).skip(page * 50).limit(50).lean(), Operation.countDocuments(filter)]);
  res.json({ success: true, data: items.map(present), total, page, pageSize: 50 });
}));
router.post('/', route(async (req, res) => res.status(202).json({ success: true, data: await createOperation(req.user, req.body) })));
router.get('/:id', route(async (req, res) => res.json({ success: true, data: present(await getOperation(req.user, req.params.id)) })));
router.post('/:id/actions', route(async (req, res) => res.status(202).json({ success: true, data: await queueAction(req.user, req.params.id, req.body.action) })));
router.get('/:id/draft', route(async (req, res) => res.json({ success: true, data: await getDraft(req.user, req.params.id) })));
router.put('/:id/draft', route(async (req, res) => res.json({ success: true, data: await saveDraft(req.user, req.params.id, req.body) })));
router.get('/:id/report.pdf', route(async (req, res) => {
  const op = await getOperation(req.user, req.params.id);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="teste-${op._id}.pdf"`, 'Cache-Control': 'no-store' });
  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  doc.on('error', () => res.destroy()); doc.pipe(res);
  doc.fillColor('#97361b').fontSize(22).text('Bansir | Operação de teste');
  doc.moveDown().fontSize(12).fillColor('#b64522').text('SEM VALOR FISCAL — NÃO É COMPROVANTE DE PAGAMENTO');
  doc.moveDown().fillColor('#231a16').fontSize(10);
  [ ['Controle', op._id], ['Ambiente', op.mode === 'demo' ? 'Demonstração: dados simulados' : 'Cielo Sandbox / SEFAZ homologação'],
    ['Data', new Date(op.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Cuiaba' })],
    ['Valor dos produtos', `R$ ${(op.totalCents / 100).toFixed(2)}`], ['Modalidade', op.method === 'credit' ? 'Crédito' : 'Débito'],
    ['Parcelas solicitadas', op.installments], ['Pagamento', op.paymentStatus], ['Situação fiscal', op.fiscalStatus],
    ['Modelo', op.model], ['Número / série', op.fiscalNumber ? `${op.fiscalNumber} / ${op.fiscalSeries}` : 'Não emitida'],
    ['Chave', op.fiscalKey || 'Não gerada'], ['Protocolo', op.protocol || 'Não recebido'], ['Retorno', op.message]
  ].forEach(([label, value]) => { doc.text(`${label}: ${value}`); doc.moveDown(0.4); });
  doc.moveDown().fontSize(13).text('Produtos'); doc.fontSize(10);
  op.items.forEach(i => doc.text(`${i.quantity} × ${i.name} — R$ ${(i.quantity * i.unitCents / 100).toFixed(2)}`));
  doc.moveDown().fontSize(13).text('Histórico'); doc.fontSize(9);
  op.events.forEach(e => { doc.text(`${new Date(e.at).toLocaleString('pt-BR', { timeZone: 'America/Cuiaba' })} — ${e.message}`); doc.moveDown(0.4); });
  doc.end();
}));
router.get('/:id/xml', route(async (req, res) => {
  const op = await getOperation(req.user, req.params.id, true);
  if (op.mode !== 'homologation' || !op.xml || op.fiscalStatus !== 'authorized') fail('XML autorizado não disponível. A consulta do protocolo, sozinha, não recupera o XML.', 409);
  res.set({ 'Content-Type': 'application/xml', 'Content-Disposition': `attachment; filename="${op.fiscalKey}.xml"`, 'Cache-Control': 'no-store' }).send(op.xml);
}));
router.get('/:id/danfe', route(async (req, res) => {
  const op = await getOperation(req.user, req.params.id, true);
  if (op.mode !== 'homologation' || op.fiscalStatus !== 'authorized' || !op.xml || !op.fiscalData) fail('DANFE exige XML e protocolo de autorização armazenados.', 409);
  const directory = await mkdtemp(join(tmpdir(), 'bansir-danfe-'));
  try {
    const outputPath = join(directory, 'danfe.pdf');
    const { NFE_GerarDanfe, NFCE_GerarDanfe } = await import('@nfewizard/danfe');
    await (op.model === '65' ? NFCE_GerarDanfe : NFE_GerarDanfe)({ data: op.fiscalData, chave: op.fiscalKey, outputPath });
    const pdf = await readFile(outputPath);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${op.fiscalKey}.pdf"`, 'Cache-Control': 'no-store' }).send(pdf);
  } finally { await rm(directory, { recursive: true, force: true }); }
}));
export default router;
