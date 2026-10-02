import mongoose from 'mongoose';

const whatsappSessionSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    data: {
      type: String,
      required: true
    }
  },
  {
    timestamps: true,
    collection: 'whatsapp_sessions'
  }
);

export const WhatsAppSession = mongoose.model('WhatsAppSession', whatsappSessionSchema);
