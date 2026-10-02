import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  type: { type: String, enum: ['sales', 'system', 'stock', 'financial'], required: true },
  title: { type: String, required: true }, desc: String, time: String,
  timestamp: { type: Date, default: Date.now }, readBy: { type: [String], default: [] }
});
export const Notification = mongoose.model('UltragasNotification', schema);
