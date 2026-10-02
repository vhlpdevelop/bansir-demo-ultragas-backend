import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  _id: String, ownerId: { type: String, required: true }, requestId: { type: String, required: true }, fingerprint: String,
  mode: { type: String, enum: ['demo', 'homologation'], required: true },
  items: [mongoose.Schema.Types.Mixed], totalCents: Number, method: String, installments: Number, model: String,
  paymentStatus: { type: String, default: 'created' }, fiscalStatus: { type: String, default: 'waiting' },
  providerOrderId: String, paymentEvidence: mongoose.Schema.Types.Mixed,
  scenario: String,
  fiscalKey: String, fiscalNumber: Number, fiscalSeries: Number, fiscalIssuedAt: String, fiscalCode: String,
  fiscalPayload: { type: mongoose.Schema.Types.Mixed, select: false },
  fiscalData: { type: mongoose.Schema.Types.Mixed, select: false }, xml: { type: String, select: false },
  protocol: String, sefazCode: String, message: String,
  xmlAvailable: { type: Boolean, default: false },
  job: String, busy: { type: Boolean, default: false }, leaseUntil: Date, lockToken: String,
  nextPollAt: Date, polls: { type: Number, default: 0 },
  events: [{ _id: false, at: Date, message: String }]
}, { timestamps: true, versionKey: false });
schema.index({ ownerId: 1, requestId: 1 }, { unique: true });
schema.index({ job: 1, busy: 1 });
schema.index({ ownerId: 1, createdAt: -1 });
schema.index({ providerOrderId: 1 }, { unique: true, sparse: true });
schema.index({ fiscalKey: 1 }, { unique: true, sparse: true });
export const Operation = mongoose.model('UltragasCheckoutOperation', schema);
export const FiscalSequence = mongoose.model('UltragasIntegrationFiscalSequence', new mongoose.Schema({ _id: String, value: Number }));
export function present(op) {
  const { fiscalPayload, fiscalData, xml, fingerprint, lockToken, leaseUntil, ...publicData } = op.toObject ? op.toObject() : op;
  return { ...publicData, id: publicData._id, hasXml: Boolean(publicData.xmlAvailable), testOnly: true };
}
