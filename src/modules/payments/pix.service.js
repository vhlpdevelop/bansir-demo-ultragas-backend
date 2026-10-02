import { StoreSettings } from '../settings/settings.model.js';
import { requireDatabase } from '../../config/db.js';
/**
 * PIX BR Code Generator — Padrão EMV QRCPS (Banco Central do Brasil)
 * 
 * Gera payload "Copia e Cola" no formato TLV (Tag-Length-Value)
 * para QR Codes PIX Estáticos conforme manual BACEN.
 * 
 * Referência: Manual de Padrões para Iniciação do Pix (BACEN)
 */

// =========================================================================
// CRC16-CCITT (polinômio 0x1021) — obrigatório para validação do BR Code
// =========================================================================
function crc16CCITT(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
    }
    crc &= 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// =========================================================================
// TLV (Tag-Length-Value) — Formato base do EMV
// =========================================================================
function tlv(id, value) {
  const len = value.length.toString().padStart(2, '0');
  return `${id}${len}${value}`;
}

// =========================================================================
// Gerador de Payload PIX (BR Code Estático)
// =========================================================================

/**
 * Gera o payload PIX (string "Copia e Cola") no padrão EMV QRCPS
 * 
 * @param {Object} params
 * @param {string} params.pixKey - Chave PIX (CPF, e-mail, telefone ou EVP)
 * @param {string} params.merchantName - Nome do recebedor (máx. 25 chars)
 * @param {string} params.merchantCity - Cidade do recebedor (máx. 15 chars)
 * @param {number} [params.amount] - Valor da transação (0 = sem valor definido)
 * @param {string} [params.txId] - Identificador da transação (máx. 25 chars)
 * @param {string} [params.description] - Descrição adicional
 * @returns {string} Payload BR Code completo com CRC16
 */
export function generatePixPayload({
  pixKey,
  merchantName = 'BANSIR ARTESANATO',
  merchantCity = 'BONITO',
  amount = 0,
  txId = '***',
  description = ''
}) {
  if (!pixKey) {
    throw new Error('Chave PIX é obrigatória para gerar o BR Code.');
  }

  // Sanitize inputs
  const cleanName = merchantName.substring(0, 25).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const cleanCity = merchantCity.substring(0, 15).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const cleanTxId = (txId || '***').substring(0, 25);

  // 1. Payload Format Indicator (ID 00) — sempre "01"
  let payload = tlv('00', '01');

  // 2. Point of Initiation Method (ID 01)
  // "11" = QR Code estático (reutilizável), "12" = dinâmico (uso único)
  payload += tlv('01', amount > 0 ? '12' : '11');

  // 3. Merchant Account Information — PIX (ID 26)
  // Sub-campos:
  //   00 = GUI (sempre "br.gov.bcb.pix")
  //   01 = Chave PIX
  //   02 = Descrição (opcional)
  let merchantAccount = tlv('00', 'br.gov.bcb.pix');
  merchantAccount += tlv('01', pixKey);
  if (description) {
    merchantAccount += tlv('02', description.substring(0, 40));
  }
  payload += tlv('26', merchantAccount);

  // 4. Merchant Category Code (ID 52) — "0000" = não informado
  payload += tlv('52', '0000');

  // 5. Transaction Currency (ID 53) — "986" = Real Brasileiro (BRL)
  payload += tlv('53', '986');

  // 6. Transaction Amount (ID 54) — valor com 2 casas decimais
  if (amount > 0) {
    payload += tlv('54', amount.toFixed(2));
  }

  // 7. Country Code (ID 58) — "BR"
  payload += tlv('58', 'BR');

  // 8. Merchant Name (ID 59)
  payload += tlv('59', cleanName);

  // 9. Merchant City (ID 60)
  payload += tlv('60', cleanCity);

  // 10. Additional Data Field Template (ID 62)
  //   Sub-campo 05 = Reference Label (txId)
  const additionalData = tlv('05', cleanTxId);
  payload += tlv('62', additionalData);

  // 11. CRC16 (ID 63) — DEVE ser o último campo
  // Adiciona "6304" (ID=63, Length=04) antes de calcular
  payload += '6304';
  const crc = crc16CCITT(payload);
  payload += crc;

  return payload;
}

/**
 * Valida se um BR Code PIX parece válido (verificação básica)
 */
export function validatePixPayload(brCode) {
  if (!brCode || brCode.length < 20) return false;
  if (!brCode.startsWith('00020126')) return false;
  
  // Verifica se termina com CRC16 válido
  const payloadWithoutCRC = brCode.slice(0, -4);
  const declaredCRC = brCode.slice(-4);
  const calculatedCRC = crc16CCITT(payloadWithoutCRC.slice(0, -0) || brCode.slice(0, -4));
  
  // Re-calculate: the payload before CRC includes "6304"
  const base = brCode.slice(0, brCode.length - 4);
  const checkCRC = crc16CCITT(base);
  
  return checkCRC === declaredCRC;
}

// =========================================================================
// Configuração compartilhada da loja, persistida no MongoDB.
export async function getPixConfig() {
  requireDatabase();
  const store = await StoreSettings.findById('store').lean();
  return { pixKey: store?.pixKey || '', pixKeyType: store?.pixKeyType || '', merchantName: store?.storeName || '', merchantCity: store?.merchantCity || '', enabled: store?.pixEnabled === true };
}
export async function updatePixConfig(data) {
  requireDatabase();
  const mapping = { pixKey: 'pixKey', pixKeyType: 'pixKeyType', merchantName: 'storeName', merchantCity: 'merchantCity', enabled: 'pixEnabled' };
  const updates = Object.fromEntries(Object.entries(mapping).filter(([key]) => data[key] !== undefined).map(([key, field]) => [field, data[key]]));
  await StoreSettings.findByIdAndUpdate('store', { $set: updates }, { upsert: true, runValidators: true });
  return getPixConfig();
}

/**
 * Gera um PIX para uma venda específica
 * 
 * @param {number} amount - Valor em R$
 * @param {string} saleNumber - Número da venda (usado como txId)
 * @returns {{ brCode: string, pixKey: string, amount: number, merchantName: string }}
 */
export async function generatePixForSale(amount, saleNumber = '') {
  const pixConfig = await getPixConfig();
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Valor inválido.');
  if (!pixConfig.merchantName || !pixConfig.merchantCity) throw new Error('Configure nome e cidade da loja em Ajustes.');
  if (!pixConfig.pixKey) {
    throw new Error('Chave PIX da loja não configurada. Configure em Ajustes.');
  }

  const txId = saleNumber 
    ? saleNumber.replace(/[^a-zA-Z0-9]/g, '').substring(0, 25) 
    : `BNS${Date.now().toString(36).toUpperCase()}`;

  const brCode = generatePixPayload({
    pixKey: pixConfig.pixKey,
    merchantName: pixConfig.merchantName,
    merchantCity: pixConfig.merchantCity,
    amount: Number(amount),
    txId,
    description: `Bansir Artesanato Bonito`
  });

  return {
    brCode,
    pixKey: pixConfig.pixKey,
    pixKeyType: pixConfig.pixKeyType,
    amount: Number(amount),
    txId,
    merchantName: pixConfig.merchantName,
    merchantCity: pixConfig.merchantCity,
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 minutos
  };
}
