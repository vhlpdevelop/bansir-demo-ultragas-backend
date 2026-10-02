import makeWASocket, { DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode';
import { useMongoDBAuthState } from './whatsappMongoAuth.js';

class WhatsAppService {
  constructor() {
    this.sock = null;
    this.status = 'DISCONNECTED';
    this.qrCodeUrl = null;
    this.clearAuth = null;
    this.isConnecting = false;

    // Em ambiente de teste automatizado, não inicia socket de rede em background
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    // Inicialização assíncrona segura que nunca derruba o processo Node.js
    setTimeout(() => {
      this.initialize().catch((err) => {
        console.error('⚠️ [WhatsApp Baileys] Erro não fatal ao inicializar:', err.message);
      });
    }, 1500);
  }

  async initialize() {
    if (this.isConnecting || this.status === 'CONNECTED') {
      return;
    }

    this.isConnecting = true;
    try {
      console.log('🔄 [WhatsApp Baileys] Conectando ao WhatsApp via WebSockets...');
      const { state, saveCreds, clearAuth } = await useMongoDBAuthState();
      this.clearAuth = clearAuth;

      this.sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        emitOwnEvents: false,
        generateHighQualityLinkPreview: false
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.status = 'WAITING_QR';
          try {
            this.qrCodeUrl = await qrcode.toDataURL(qr);
            console.log('📱 [WhatsApp Baileys] Novo QR Code gerado para pareamento.');
          } catch (qrErr) {
            console.error('Erro ao converter QR Code:', qrErr);
          }
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;

          console.log(`⚠️ [WhatsApp Baileys] Conexão fechada. Código: ${statusCode || 'desconhecido'}.`);

          this.isConnecting = false;
          this.qrCodeUrl = null;

          if (isLoggedOut) {
            console.log('🚪 [WhatsApp Baileys] Sessão desconectada pelo usuário.');
            this.status = 'DISCONNECTED';
            if (this.clearAuth) {
              await this.clearAuth();
            }
          } else {
            this.status = 'DISCONNECTED';
            console.log('🔄 [WhatsApp Baileys] Tentando reconectar em 5 segundos...');
            setTimeout(() => {
              this.initialize().catch(() => {});
            }, 5000);
          }
        } else if (connection === 'open') {
          this.isConnecting = false;
          this.status = 'CONNECTED';
          this.qrCodeUrl = null;
          console.log('✅ [WhatsApp Baileys] Conectado e pronto para enviar mensagens!');
        }
      });
    } catch (error) {
      this.isConnecting = false;
      this.status = 'DISCONNECTED';
      console.error('❌ [WhatsApp Baileys] Erro na inicialização:', error.message);
    }
  }

  getStatus() {
    return {
      status: this.status,
      qrCodeUrl: this.qrCodeUrl
    };
  }

  async logout() {
    try {
      if (this.sock) {
        await this.sock.logout();
      }
    } catch (error) {
      console.error('Erro ao deslogar do Baileys:', error.message);
    }

    try {
      if (this.clearAuth) {
        await this.clearAuth();
      }
    } catch (err) {
      console.error('Erro ao limpar credenciais do MongoDB:', err.message);
    }

    this.status = 'DISCONNECTED';
    this.qrCodeUrl = null;
    this.sock = null;
    this.isConnecting = false;
  }

  async sendMessage(phone, message) {
    if (this.status !== 'CONNECTED' || !this.sock) {
      console.log('⚠️ [WhatsApp] Bot não conectado. Mensagem não enviada.');
      return false;
    }
    try {
      let cleanPhone = String(phone).replace(/\D/g, '');
      if (cleanPhone.length === 10 || cleanPhone.length === 11) {
        cleanPhone = '55' + cleanPhone;
      }
      const jid = `${cleanPhone}@s.whatsapp.net`;
      await this.sock.sendMessage(jid, { text: message });
      console.log(`📤 [WhatsApp] Mensagem de texto enviada com sucesso para ${cleanPhone}`);
      return true;
    } catch (error) {
      console.error('❌ [WhatsApp] Erro ao enviar mensagem:', error.message);
      return false;
    }
  }

  async sendMessageWithImage(phone, message, base64Data) {
    if (this.status !== 'CONNECTED' || !this.sock) {
      console.log('⚠️ [WhatsApp] Bot não conectado. Imagem não enviada.');
      return false;
    }
    try {
      let cleanPhone = String(phone).replace(/\D/g, '');
      if (cleanPhone.length === 10 || cleanPhone.length === 11) {
        cleanPhone = '55' + cleanPhone;
      }
      const jid = `${cleanPhone}@s.whatsapp.net`;

      let buffer;
      if (Buffer.isBuffer(base64Data)) {
        buffer = base64Data;
      } else if (typeof base64Data === 'string') {
        const base64Str = base64Data.replace(/^data:image\/[a-zA-Z0-9.+_-]+;base64,/, '');
        buffer = Buffer.from(base64Str, 'base64');
      } else {
        throw new Error('Formato de imagem inválido');
      }

      await this.sock.sendMessage(jid, {
        image: buffer,
        caption: message,
        mimetype: 'image/png'
      });

      console.log(`📤 [WhatsApp] Imagem enviada com sucesso para ${cleanPhone}`);
      return true;
    } catch (error) {
      console.error('❌ [WhatsApp] Erro ao enviar imagem:', error.message);
      return false;
    }
  }
}

export const whatsappService = new WhatsAppService();
