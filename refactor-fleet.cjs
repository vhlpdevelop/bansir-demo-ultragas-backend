const fs = require('fs');

const path = 'c:/Users/user/Desktop/projetos/Bansir/bansir-demo-ultragas-backend/src/app.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Add import
content = content.replace(
  "import whatsappRoutes from './modules/whatsapp/whatsapp.routes.js';",
  "import whatsappRoutes from './modules/whatsapp/whatsapp.routes.js';\nimport vehicleRoutes from './modules/fleet/vehicle.routes.js';"
);

// 2. Add app.use
content = content.replace(
  "app.use('/api/v1/whatsapp', whatsappRoutes);",
  "app.use('/api/v1/whatsapp', whatsappRoutes);\napp.use('/api/v1/fleet/vehicles', vehicleRoutes);"
);

fs.writeFileSync(path, content, 'utf8');
console.log('Backend app.js updated for vehicles');
