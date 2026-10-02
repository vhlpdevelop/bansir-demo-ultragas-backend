const fs = require('fs');

let appJs = fs.readFileSync('src/app.js', 'utf8');

if (!appJs.includes('voucherRoutes')) {
  appJs = appJs.replace(
    "import settingsRoutes from './modules/settings/settings.routes.js';",
    "import settingsRoutes from './modules/settings/settings.routes.js';\nimport voucherRoutes from './modules/vouchers/voucher.routes.js';"
  );
  
  appJs = appJs.replace(
    "app.use('/api/settings', settingsRoutes);",
    "app.use('/api/settings', settingsRoutes);\napp.use('/api/vouchers', voucherRoutes);"
  );
  
  fs.writeFileSync('src/app.js', appJs, 'utf8');
  console.log('Backend app.js updated with vouchers route.');
} else {
  console.log('voucherRoutes already in app.js');
}
