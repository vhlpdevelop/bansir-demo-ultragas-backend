import mongoose from 'mongoose';

const vehicleSchema = new mongoose.Schema(
  {
    code: { type: String, required: true },
    name: { type: String, required: true },
    plate: { type: String },
    brand: { type: String },
    year: { type: Number },
    type: {
      type: String,
      enum: ['CARRO', 'CAMINHÃO', 'MOTO', 'OUTROS'],
      default: 'CAMINHÃO'
    },
    status: {
      type: String,
      enum: ['ATIVO', 'MANUTENÇÃO', 'VENDIDO'],
      default: 'ATIVO'
    },
    purchaseValue: { type: Number, default: 0 },
    notes: { type: String },
    currentKm: { type: Number, default: 0 },
    lastKmUpdate: { type: Date },
    maintenanceRules: [
      {
        name: { type: String, required: true },
        intervalKm: { type: Number, required: true },
        lastServiceKm: { type: Number, default: 0 }
      }
    ]
  },
  { timestamps: true, collection: 'ultragas_vehicles' }
);

export const Vehicle = mongoose.model('UltragasVehicle', vehicleSchema);
