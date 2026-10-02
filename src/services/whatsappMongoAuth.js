import mongoose from 'mongoose';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';
import { WhatsAppSession } from '../modules/whatsapp/whatsappSession.model.js';

/**
 * Provedor de autenticação Baileys persistido no MongoDB Atlas.
 * Garante que a sessão do WhatsApp permaneça salva mesmo quando o Render
 * reinicia ou faz novos deploys em containers efêmeros.
 */
export const useMongoDBAuthState = async () => {
  const isDbReady = () => mongoose.connection && mongoose.connection.readyState === 1;

  const writeData = async (data, key) => {
    if (!isDbReady()) return;
    try {
      const serialized = JSON.stringify(data, BufferJSON.replacer);
      await WhatsAppSession.findOneAndUpdate(
        { key },
        { key, data: serialized },
        { upsert: true, new: true }
      );
    } catch (err) {
      console.error(`[Baileys Auth] Erro ao gravar chave ${key} no MongoDB:`, err.message);
    }
  };

  const readData = async (key) => {
    if (!isDbReady()) return null;
    try {
      const doc = await WhatsAppSession.findOne({ key });
      if (!doc || !doc.data) return null;
      return JSON.parse(doc.data, BufferJSON.reviver);
    } catch (err) {
      console.error(`[Baileys Auth] Erro ao ler chave ${key} do MongoDB:`, err.message);
      return null;
    }
  };

  const removeData = async (key) => {
    if (!isDbReady()) return;
    try {
      await WhatsAppSession.deleteOne({ key });
    } catch (err) {
      console.error(`[Baileys Auth] Erro ao remover chave ${key} do MongoDB:`, err.message);
    }
  };

  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          if (!isDbReady()) return;
          const bulkOps = [];
          
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              
              if (value) {
                const serialized = JSON.stringify(value, BufferJSON.replacer);
                bulkOps.push({
                  updateOne: {
                    filter: { key },
                    update: { $set: { key, data: serialized } },
                    upsert: true
                  }
                });
              } else {
                bulkOps.push({
                  deleteOne: {
                    filter: { key }
                  }
                });
              }
            }
          }

          if (bulkOps.length > 0) {
            try {
              await WhatsAppSession.bulkWrite(bulkOps, { ordered: false });
            } catch (err) {
              console.error('[Baileys Auth] Erro no bulkWrite:', err.message);
            }
          }
        }
      }
    },
    saveCreds: () => writeData(creds, 'creds'),
    clearAuth: async () => {
      try {
        await WhatsAppSession.deleteMany({});
      } catch (err) {
        console.error('[Baileys Auth] Erro ao limpar sessões no MongoDB:', err.message);
      }
    }
  };
};
