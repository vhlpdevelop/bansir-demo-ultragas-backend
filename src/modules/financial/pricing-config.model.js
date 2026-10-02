import mongoose from 'mongoose';
const schema = new mongoose.Schema({ _id: { type: String }, settings: { type: mongoose.Schema.Types.Mixed, required: true } }, { timestamps: true });
export const PricingConfig = mongoose.model('UltragazPricingConfig', schema);
