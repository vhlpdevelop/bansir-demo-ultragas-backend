import { httpError } from './database.js';

const IBPT_API_URL = 'https://apidoni.ibpt.org.br/api/v1/produtos';

// Conforme Manual De Olho no Imposto 0.13: origens 0, 3, 4 e 5 usam nacionalfederal; 1, 2, 6, 7 e 8 usam importadosfederal.
const IMPORTED_ORIGINS = new Set([1, 2, 6, 7, 8]);
const FALLBACK_CACHE_DAYS = 30;
const API_TIMEOUT_MS = 3500;

export function normalizeNcm(ncm) {
  const digits = String(ncm || '').replace(/\D/g, '');
  if (!digits || digits.length > 8) return '';
  const padded = digits.padStart(8, '0');
  return padded === '00000000' ? '' : padded;
}

export function normalizeCnpj(cnpj) {
  const digits = String(cnpj || '').replace(/\D/g, '');
  return /^\d{14}$/.test(digits) ? digits : '';
}

export function parseIbptDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}

export function isCacheValid(cached, { hasToken = false, now = new Date() } = {}) {
  if (!cached) return false;
  if (!hasToken) return true;
  if (!cached.chave && !cached.versao) return false;

  const vigenciaFim = parseIbptDate(cached.vigencia_fim);
  if (vigenciaFim) {
    const todayIso = now.toISOString().slice(0, 10);
    return todayIso <= vigenciaFim;
  }

  const ageDays = (now.getTime() - new Date(cached.updated_at).getTime()) / (1000 * 60 * 60 * 24);
  return ageDays < FALLBACK_CACHE_DAYS;
}

function rowToRate(row) {
  return {
    cnpj: row.cnpj || '',
    ncm: row.ncm,
    uf: row.uf,
    ex: Number(row.ex || 0),
    nacional: Number(row.nacional),
    estadual: Number(row.estadual),
    importado: Number(row.importado),
    municipal: Number(row.municipal),
    chave: row.chave || '',
    versao: row.versao || '',
    fonte: row.fonte || 'IBPT',
    vigenciaInicio: parseIbptDate(row.vigencia_inicio),
    vigenciaFim: parseIbptDate(row.vigencia_fim)
  };
}

function formatBrl(cents) {
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Consulta no cache local (tenant + CNPJ + UF + NCM + EX) ou atualiza via API oficial do IBPT usando o Token do cliente.
 */
export async function getIbptRate(c, {
  tenantId,
  uf,
  ncm,
  ex = 0,
  token,
  cnpj,
  description = '',
  unit = 'UN',
  value = 0,
  gtin = 'SEM GTIN',
  internalCode = '',
  forceRefresh = false,
  throwOnError = false,
  fetcher = fetch,
  now = new Date()
}) {
  const cleanNcm = normalizeNcm(ncm);
  const cleanUf = String(uf || '').trim().toUpperCase();
  const cleanCnpj = normalizeCnpj(cnpj);
  const cleanEx = Math.max(0, Number.parseInt(ex || 0, 10) || 0);
  const cleanToken = String(token || '').trim();

  if (!cleanNcm || !/^[A-Z]{2}$/.test(cleanUf)) return null;

  const cached = (await c.query(
    'SELECT * FROM bansir.ibpt_taxes WHERE tenant_id=$1 AND cnpj=$2 AND uf=$3 AND ncm=$4 AND ex=$5',
    [tenantId, cleanCnpj, cleanUf, cleanNcm, cleanEx]
  )).rows[0];

  if (cached && !forceRefresh && isCacheValid(cached, { hasToken: Boolean(cleanToken && cleanCnpj), now })) {
    return rowToRate(cached);
  }

  if (cleanToken && cleanCnpj) {
    const params = new URLSearchParams({
      token: cleanToken,
      cnpj: cleanCnpj,
      codigo: cleanNcm,
      uf: cleanUf,
      ex: String(cleanEx),
      descricao: String(description || 'PRODUTO').trim().slice(0, 100) || 'PRODUTO',
      unidadeMedida: String(unit || 'UN').trim().slice(0, 6) || 'UN',
      valor: Number(value > 0 ? value : 1).toFixed(2),
      gtin: String(gtin || 'SEM GTIN').trim().slice(0, 20) || 'SEM GTIN',
      codigoInterno: String(internalCode || cleanNcm).trim().slice(0, 60) || cleanNcm
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const res = await fetcher(`${IBPT_API_URL}?${params.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });

      if (!res.ok) {
        if (throwOnError) {
          if (res.status === 401 || res.status === 403) {
            throw httpError(400, 'Token ou CNPJ não autorizado pelo portal De Olho no Imposto (IBPT).', 'IBPT_UNAUTHORIZED');
          }
          if (res.status === 404) {
            throw httpError(404, `NCM ${cleanNcm} não encontrado na API do IBPT para ${cleanUf}.`, 'IBPT_NCM_NOT_FOUND');
          }
          throw httpError(502, `API do IBPT retornou HTTP ${res.status}.`, 'IBPT_API_ERROR');
        }
      } else {
        const data = await res.json();
        if (data && (data.Nacional !== undefined || data.Estadual !== undefined || data.Importado !== undefined || data.Municipal !== undefined)) {
          const nacional = Number(data.Nacional ?? 0);
          const estadual = Number(data.Estadual ?? 0);
          const importado = Number(data.Importado ?? 0);
          const municipal = Number(data.Municipal ?? 0);
          const chave = String(data.Chave || '').trim().slice(0, 20);
          const versao = String(data.Versao || '').trim().slice(0, 20);
          const fonte = String(data.Fonte || 'IBPT').trim().slice(0, 50) || 'IBPT';
          const vigenciaInicio = parseIbptDate(data.VigenciaInicio);
          const vigenciaFim = parseIbptDate(data.VigenciaFim);

          await c.query(`
            INSERT INTO bansir.ibpt_taxes(
              tenant_id, cnpj, uf, ncm, ex, tipo, description,
              nacional, estadual, importado, municipal,
              chave, versao, fonte, vigencia_inicio, vigencia_fim, updated_at
            )
            VALUES($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
            ON CONFLICT (tenant_id, cnpj, uf, ncm, ex) DO UPDATE SET
              description=EXCLUDED.description,
              nacional=EXCLUDED.nacional,
              estadual=EXCLUDED.estadual,
              importado=EXCLUDED.importado,
              municipal=EXCLUDED.municipal,
              chave=EXCLUDED.chave,
              versao=EXCLUDED.versao,
              fonte=EXCLUDED.fonte,
              vigencia_inicio=COALESCE(EXCLUDED.vigencia_inicio, bansir.ibpt_taxes.vigencia_inicio),
              vigencia_fim=COALESCE(EXCLUDED.vigencia_fim, bansir.ibpt_taxes.vigencia_fim),
              updated_at=now()
          `, [
            tenantId, cleanCnpj, cleanUf, cleanNcm, cleanEx,
            String(description || '').slice(0, 200),
            nacional, estadual, importado, municipal,
            chave, versao, fonte, vigenciaInicio, vigenciaFim
          ]);

          return {
            cnpj: cleanCnpj,
            ncm: cleanNcm,
            uf: cleanUf,
            ex: cleanEx,
            nacional,
            estadual,
            importado,
            municipal,
            chave,
            versao,
            fonte,
            vigenciaInicio,
            vigenciaFim
          };
        }
        if (throwOnError) {
          throw httpError(502, 'Resposta inesperada da API do IBPT.', 'IBPT_INVALID_RESPONSE');
        }
      }
    } catch (err) {
      if (throwOnError) {
        if (err.status) throw err;
        throw httpError(502, 'Não foi possível conectar à API do IBPT no momento.', 'IBPT_UNAVAILABLE');
      }
      console.warn('[IBPT] Erro ao consultar API oficial (usando cache/fallback se houver):', err.message);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return cached ? rowToRate(cached) : null;
}

/**
 * Enriquece o draft de NF-e (modelo 55) com vTotTrib por item/total e texto legal da Lei 12.741/2012.
 */
export async function applyIbptToDraft(c, identity, draft, { model = '55', cfg, fetcher = fetch, now = new Date() } = {}) {
  if (model !== '55' || !draft || !Array.isArray(draft.det)) return draft;

  const s = cfg?.data || {};
  const token = s.ibptToken || null;
  const cnpj = normalizeCnpj(s.cnpj);
  const uf = String(s.address?.uf || '').trim().toUpperCase();
  if (!uf || !cnpj) return draft;

  const tenantId = identity.tenantId;
  const rateMemo = new Map();

  let totalFedCents = 0;
  let totalEstCents = 0;
  let totalMunCents = 0;
  const sources = new Set();
  const chaves = new Set();

  for (const item of draft.det) {
    const cleanNcm = normalizeNcm(item.prod?.NCM);
    if (!cleanNcm) continue;

    const ex = Math.max(0, Number.parseInt(item.prod?.EXTIPI || 0, 10) || 0);
    const memoKey = `${cnpj}:${uf}:${cleanNcm}:${ex}`;

    const vProd = Number(item.prod?.vProd || 0);
    const vDesc = Number(item.prod?.vDesc || 0);
    const netItemValue = Math.max(0, vProd - vDesc);
    const origin = item.imposto?.ICMS ? (Object.values(item.imposto.ICMS)[0]?.orig ?? 0) : 0;

    let rate = rateMemo.get(memoKey);
    if (rate === undefined) {
      rate = await getIbptRate(c, {
        tenantId,
        uf,
        ncm: cleanNcm,
        ex,
        token,
        cnpj,
        description: item.prod?.xProd,
        unit: item.prod?.uCom,
        value: netItemValue,
        gtin: item.prod?.cEAN,
        internalCode: item.prod?.cProd,
        fetcher,
        now
      });
      rateMemo.set(memoKey, rate);
    }

    if (rate) {
      const isImported = IMPORTED_ORIGINS.has(Number(origin));
      const fedRate = isImported ? rate.importado : rate.nacional;
      const fedCents = Math.round(netItemValue * fedRate);
      const estCents = Math.round(netItemValue * rate.estadual);
      const munCents = Math.round(netItemValue * rate.municipal);
      const itemTaxCents = fedCents + estCents + munCents;

      item.imposto = item.imposto || {};
      item.imposto.vTotTrib = itemTaxCents / 100;

      totalFedCents += fedCents;
      totalEstCents += estCents;
      totalMunCents += munCents;

      if (rate.fonte) sources.add(rate.fonte);
      if (rate.chave) chaves.add(rate.chave);
    }
  }

  const totalTaxCents = totalFedCents + totalEstCents + totalMunCents;
  if (totalTaxCents <= 0 && chaves.size === 0 && sources.size === 0) {
    return draft;
  }

  const totalTax = totalTaxCents / 100;
  const vNF = Number(draft.total?.ICMSTot?.vNF || 0);
  const pct = vNF > 0 ? ((totalTax / vNF) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00';

  if (draft.total?.ICMSTot && totalTaxCents > 0) {
    draft.total.ICMSTot.vTotTrib = totalTax;
  }

  const fonteLabel = [...sources].filter(Boolean).join('/') || 'IBPT';
  const chaveLabel = [...chaves].filter(Boolean).join('/');
  const ibptNotice = `Trib. aprox.: R$ ${formatBrl(totalFedCents)} Federal, R$ ${formatBrl(totalEstCents)} Estadual e R$ ${formatBrl(totalMunCents)} Municipal (Total R$ ${formatBrl(totalTaxCents)} - ${pct}%) | Lei da Transparência 12.741/2012 | Fonte: ${fonteLabel}${chaveLabel ? ` Chave ${chaveLabel}` : ''}`;

  draft.infAdic = draft.infAdic || {};
  const currentInfCpl = draft.infAdic.infCpl ? String(draft.infAdic.infCpl).trim() : '';

  if (!currentInfCpl) {
    draft.infAdic.infCpl = ibptNotice;
  } else if (!currentInfCpl.includes('Lei da Transparência') && !currentInfCpl.includes('Trib. aprox.:')) {
    draft.infAdic.infCpl = `${currentInfCpl} | ${ibptNotice}`;
  }

  return draft;
}

/**
 * Testa o Token IBPT e sincroniza em cache os NCMs dos produtos ativos do estabelecimento.
 */
export async function syncEstablishmentIbpt(c, identity, { cfg, token, fetcher = fetch, now = new Date() }) {
  const s = cfg?.data || {};
  const cnpj = normalizeCnpj(s.cnpj);
  const uf = String(s.address?.uf || '').trim().toUpperCase();
  const cleanToken = String(token || s.ibptToken || '').trim();

  if (!cnpj || !uf) {
    throw httpError(409, 'Salve CNPJ e UF do emitente antes de sincronizar o IBPT.', 'FISCAL_SETTINGS_REQUIRED');
  }
  if (!cleanToken) {
    throw httpError(400, 'Informe o Token IBPT antes de testar a consulta.', 'IBPT_TOKEN_REQUIRED');
  }

  const { rows: productNcms } = await c.query(`
    SELECT regexp_replace(ncm, '\\D', '', 'g') AS ncm,
           max(name) AS name,
           max(unit) AS unit,
           max(price_cents) AS price_cents
    FROM bansir.products
    WHERE active = true AND length(regexp_replace(ncm, '\\D', '', 'g')) = 8
    GROUP BY 1
    ORDER BY 1
    LIMIT 50
  `);

  const targets = productNcms.length
    ? productNcms
    : [{ ncm: '27111910', name: 'GAS LIQUEFEITO DE PETROLEO GLP', unit: 'UN', price_cents: 10000 }];

  const synced = [];
  const notFound = [];

  for (let idx = 0; idx < targets.length; idx++) {
    const item = targets[idx];
    try {
      const rate = await getIbptRate(c, {
        tenantId: identity.tenantId,
        uf,
        ncm: item.ncm,
        ex: 0,
        token: cleanToken,
        cnpj,
        description: item.name,
        unit: item.unit,
        value: Number(item.price_cents || 10000) / 100,
        forceRefresh: true,
        throwOnError: true,
        fetcher,
        now
      });
      if (rate) synced.push(rate);
    } catch (err) {
      if (err.code === 'IBPT_NCM_NOT_FOUND' && idx > 0) {
        notFound.push(item.ncm);
        continue;
      }
      throw err;
    }
  }

  const first = synced[0] || {};
  return {
    cnpj,
    uf,
    syncedCount: synced.length,
    notFound,
    versao: first.versao || '',
    chave: first.chave || '',
    vigenciaFim: first.vigenciaFim || null,
    rates: synced
  };
}
