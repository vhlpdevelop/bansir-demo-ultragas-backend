import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode';
import os from 'os';
import path from 'path';

class WhatsAppService {
  constructor() {
    this.client = new Client({
      authStrategy: new LocalAuth({ 
        clientId: 'ultragas-pdv',
        dataPath: path.join(os.tmpdir(), '.wwebjs_auth')
      }),
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      }
    });

    this.status = 'DISCONNECTED';
    this.qrCodeUrl = null;

    this.initialize();
  }

  initialize() {
    this.client.on('qr', async (qr) => {
      this.status = 'WAITING_QR';
      try {
        this.qrCodeUrl = await qrcode.toDataURL(qr);
      } catch (err) {
        console.error('Failed to generate QR Code:', err);
      }
    });

    this.client.on('ready', () => {
      this.status = 'CONNECTED';
      this.qrCodeUrl = null;
      console.log('WhatsApp Web is ready!');
    });

    this.client.on('authenticated', () => {
      this.status = 'AUTHENTICATED';
    });

    this.client.on('auth_failure', () => {
      this.status = 'AUTH_FAILURE';
    });

    this.client.on('disconnected', (reason) => {
      console.log('WhatsApp Web disconnected:', reason);
      this.status = 'DISCONNECTED';
      this.client.initialize(); // Reinitialize
    });

    this.client.initialize();
  }

  getStatus() {
    return {
      status: this.status,
      qrCodeUrl: this.qrCodeUrl
    };
  }

  async logout() {
    try {
      await this.client.logout();
      this.status = 'DISCONNECTED';
      this.qrCodeUrl = null;
    } catch (error) {
      console.error('Error logging out:', error);
    }
  }

  async sendMessage(phone, message) {
    if (this.status !== 'CONNECTED') {
      console.log('WhatsApp is not connected, cannot send message.');
      return false;
    }
    try {
      // Format phone number to WhatsApp format (Brazil country code assumed if not provided)
      let cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone.length === 10 || cleanPhone.length === 11) {
        cleanPhone = '55' + cleanPhone;
      }
      const chatId = cleanPhone + '@c.us';
      await this.client.sendMessage(chatId, message);
      console.log(`Message sent to ${cleanPhone}`);
      return true;
    } catch (error) {
      console.error('Error sending WhatsApp message:', error);
      return false;
    }
  }
  async sendMessageWithImage(phone, message, base64Data) {
    if (this.status !== 'CONNECTED') {
      console.log('WhatsApp is not connected, cannot send image.');
      return false;
    }
    try {
      let cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone.length === 10 || cleanPhone.length === 11) {
        cleanPhone = '55' + cleanPhone;
      }
      const chatId = cleanPhone + '@c.us';

      // base64Data usually looks like "data:image/png;base64,iVBORw0KGgo..."
      const match = base64Data.match(/^data:([^;]+);base64,(.+)$/);
      let media;
      if (match) {
        media = new MessageMedia(match[1], match[2], 'qrcode.png');
      } else {
        media = new MessageMedia('image/png', base64Data, 'qrcode.png');
      }

      await this.client.sendMessage(chatId, media, { caption: message });
      console.log(`Image message sent to ${cleanPhone}`);
      return true;
    } catch (error) {
      console.error('Error sending WhatsApp image message:', error);
      return false;
    }
  }
}

export const whatsappService = new WhatsAppService();
