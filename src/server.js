import { config } from './config/env.js';
import { connectDB } from './config/db.js';
import { initRenderKeepAlive } from './utils/renderKeepAlive.js';
import { createServer } from 'node:http';
import { attachBridgeGateway } from './modules/bridge/bridge.gateway.js';

const PORT = config.port || 5000;

async function startServer() {
  try {
    if (!config.jwtSecret) throw new Error('JWT_SECRET é obrigatória. Configure no .env ou no ambiente.');
    // Attempt MongoDB connection
    await connectDB();
    // Routes import models: load them only after MongoDB is ready.
    const { default: app } = await import('./app.js');
    const { startOperationsWorker } = await import('./modules/operations/operation.service.js');
    await startOperationsWorker();

    const server = createServer(app);
    attachBridgeGateway(server);
    server.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(`🏺 Bansir SaaS API Rodando com Sucesso!`);
      console.log(`📡 Porta: http://localhost:${PORT}`);
      console.log(`🏥 Health Check: http://localhost:${PORT}/api/health`);
      console.log(`🔐 Módulo Auth: http://localhost:${PORT}/api/v1/auth`);
      console.log(`👥 Módulo Usuários & Hierarquia: http://localhost:${PORT}/api/v1/users`);
      console.log(`💰 Módulo Financeiro: http://localhost:${PORT}/api/v1/financial`);
      console.log(`====================================================`);

      // Inicializa o mecanismo anti-sleep para o Render.com
      initRenderKeepAlive(config.renderExternalUrl, config.keepAliveIntervalMinutes);
    });
  } catch (error) {
    console.error('Falha ao iniciar o servidor:', error);
    process.exit(1);
  }
}

startServer();
