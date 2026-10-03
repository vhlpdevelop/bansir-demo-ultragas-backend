import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  tokenId: { type: String, required: true, unique: true, index: true },
  tokenHash: { type: String, required: true, select: false },
  label: { type: String, required: true, trim: true, maxlength: 100 },
  tenantKey: { type: String, default: 'default', index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'UltragasUser', required: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  lastUsedAt: { type: Date, default: null },
  lastMachine: { type: String, default: '', maxlength: 100 }
}, { timestamps: true, collection: 'bansir_bridge_credentials' });

export const BridgeCredential = mongoose.model('BansirBridgeCredential', schema);
