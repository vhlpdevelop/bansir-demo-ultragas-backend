/**
 * Render Keep-Alive — Mecanismo Anti-Sleep para Hospedagem no Render.com
 * 
 * O Render (plano gratuito) suspende (dorme) o serviço web após 15 minutos de inatividade,
 * causando um "cold start" (espera de 50+ segundos) na próxima requisição do usuário.
 * 
 * Este módulo realiza um auto-ping (heartbeat) periódico para a rota /api/health
 * a cada 14 minutos, mantendo a API 100% acordada e com resposta instantânea.
 * 
 * Variáveis de Ambiente suportadas:
 * - RENDER_EXTERNAL_URL: Fornecida automaticamente pelo Render (ex: https://bansir-api.onrender.com)
 * - KEEP_ALIVE_URL: URL personalizada de ping
 * - KEEP_ALIVE_INTERVAL_MINUTES: Intervalo de ping em minutos (padrão: 14)
 */

export function initRenderKeepAlive(customUrl = null, intervalMinutes = 14) {
  const url = customUrl || 
              process.env.RENDER_EXTERNAL_URL || 
              process.env.KEEP_ALIVE_URL || 
              (process.env.RENDER === 'true' || process.env.NODE_ENV === 'production' 
                ? 'https://bansir-demo-caroline-backend.onrender.com' 
                : null);
  const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;

  // Se estiver em ambiente local e sem URL de produção definida, não precisa auto-pingar
  if (!url) {
    console.log('💤 [Render Keep-Alive] Ambiente local detectado. Auto-ping em espera.');
    return null;
  }

  const targetHealthUrl = url.endsWith('/api/health') 
    ? url 
    : `${url.replace(/\/+$/, '')}/api/health`;

  console.log(`⏰ [Render Keep-Alive] Ativado! Auto-ping configurado para ${targetHealthUrl} a cada ${intervalMinutes} minutos.`);

  const ping = async () => {
    try {
      const response = await fetch(targetHealthUrl, {
        headers: { 'User-Agent': 'Bansir-KeepAlive-Ping/1.0' }
      });
      if (response.ok) {
        console.log(`⚡ [Render Keep-Alive] Auto-ping executado com sucesso: ${response.status} OK (${new Date().toLocaleTimeString('pt-BR')}) - Servidor mantido acordado!`);
      } else {
        console.warn(`⚠️ [Render Keep-Alive] Auto-ping respondeu com status: ${response.status}`);
      }
    } catch (err) {
      console.warn(`⚠️ [Render Keep-Alive] Falha momentânea no auto-ping: ${err.message}`);
    }
  };

  // Agenda o primeiro ping após o intervalo e repete periodicamente
  const timerId = setInterval(ping, intervalMs);

  return {
    stop: () => clearInterval(timerId),
    trigger: ping,
    targetUrl: targetHealthUrl,
    intervalMinutes
  };
}
