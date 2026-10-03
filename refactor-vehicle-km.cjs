const fs = require('fs');

const path = 'c:/Users/user/Desktop/projetos/Bansir/bansir-demo-ultragas-backend/src/modules/fleet/vehicle.model.js';
let content = fs.readFileSync(path, 'utf8');

const oldSchema = `    purchaseValue: { type: Number, default: 0 },
    notes: { type: String }
  },`;

const newSchema = `    purchaseValue: { type: Number, default: 0 },
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
  },`;

content = content.replace(oldSchema, newSchema);

fs.writeFileSync(path, content, 'utf8');
console.log('vehicle.model.js updated');
