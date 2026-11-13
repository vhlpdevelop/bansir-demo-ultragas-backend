import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seal, secretContext } from '../src/postgres/secrets.js';
import {
  applyIbptToDraft,
  getIbptRate,
  isCacheValid,
  normalizeCnpj,
  normalizeNcm,
  parseIbptDate,
  syncEstablishmentIbpt
} from '../src/postgres/ibpt.js';

function createMockDb(initialRows = []) {
  const rows = new Map(
    initialRows.map(r => [`${r.tenant_id}:${r.cnpj || ''}:${r.uf}:${r.ncm}:${r.ex}`, { ...r }])
  );
  const products = [
    { ncm: '27111910', name: 'GAS GLP P13', unit: 'UN', price_cents: 11000 },
    { ncm: '22011000', name: 'AGUA MINERAL 20L', unit: 'UN', price_cents: 1500 }
  ];

  return {
    rows,
    async query(sql, params = []) {
      if (sql.includes('FROM bansir.ibpt_taxes WHERE tenant_id=$1')) {
        const key = `${params[0]}:${params[1]}:${params[2]}:${params[3]}:${params[4]}`;
        const hit = rows.get(key);
        return { rows: hit ? [hit] : [] };
      }
      if (sql.includes('INSERT INTO bansir.ibpt_taxes')) {
        const [
          tenant_id, cnpj, uf, ncm, ex, description,
          nacional, estadual, importado, municipal,
          chave, versao, fonte, vigencia_inicio, vigencia_fim
        ] = params;
        const key = `${tenant_id}:${cnpj}:${uf}:${ncm}:${ex}`;
        rows.set(key, {
          tenant_id, cnpj, uf, ncm, ex, description,
          nacional, estadual, importado, municipal,
          chave, versao, fonte, vigencia_inicio, vigencia_fim,
          updated_at: new Date().toISOString()
        });
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('FROM bansir.products')) {
        return { rows: products };
      }
      throw new Error(`Unexpected SQL in mock: ${sql}`);
    }
  };
}

test('IBPT normalizers and date/validity helpers follow official format', () => {
  assert.equal(normalizeNcm('2711.19.10'), '27111910');
  assert.equal(normalizeNcm('00000000'), '');
  assert.equal(normalizeNcm('123456789'), '');
  assert.equal(normalizeCnpj('40.740.307/0001-43'), '40740307000143');
  assert.equal(normalizeCnpj('123'), '');
  assert.equal(parseIbptDate('20/10/2026'), '2026-10-20');
  assert.equal(parseIbptDate('2026-11-30T00:00:00Z'), '2026-11-30');

  assert.equal(isCacheValid(
    { chave: 'AA45DF', versao: '26.2.C', vigencia_fim: '2026-11-30', updated_at: '2026-10-20T10:00:00Z' },
    { hasToken: true, now: new Date('2026-11-12T12:00:00Z') }
  ), true);

  assert.equal(isCacheValid(
    { chave: 'AA45DF', versao: '26.2.C', vigencia_fim: '2026-11-30', updated_at: '2026-10-20T10:00:00Z' },
    { hasToken: true, now: new Date('2026-12-01T12:00:00Z') }
  ), false);
});

test('getIbptRate scopes cache per tenant and emitter CNPJ and refreshes expired rates from API', async () => {
  const db = createMockDb([
    {
      tenant_id: 't1',
      cnpj: '40740307000143',
      uf: 'MS',
      ncm: '27111910',
      ex: 0,
      nacional: 0,
      estadual: 22.1,
      importado: 0,
      municipal: 0,
      chave: 'AA45DF',
      versao: '26.2.C',
      fonte: 'IBPT/empresometro.com.br',
      vigencia_inicio: '2026-10-20',
      vigencia_fim: '2026-11-30',
      updated_at: '2026-10-20T12:00:00Z'
    }
  ]);

  let apiCalls = 0;
  const fetcher = async url => {
    apiCalls++;
    const u = new URL(url);
    return {
      ok: true,
      async json() {
        return {
          Codigo: u.searchParams.get('codigo'),
          UF: u.searchParams.get('uf'),
          Nacional: 0,
          Estadual: 23.5,
          Importado: 0,
          Municipal: 0,
          Chave: u.searchParams.get('cnpj') === '11222333000181' ? 'BB99ZZ' : 'NEWKEY',
          Versao: '26.2.D',
          Fonte: 'IBPT/empresometro.com.br',
          VigenciaInicio: '01/12/2026',
          VigenciaFim: '31/12/2026'
        };
      }
    };
  };

  // Cache hit inside validity window does not call API
  const hit = await getIbptRate(db, {
    tenantId: 't1',
    uf: 'MS',
    ncm: '27111910',
    cnpj: '40740307000143',
    token: 'tok-ms-1',
    fetcher,
    now: new Date('2026-11-12T12:00:00Z')
  });
  assert.equal(apiCalls, 0);
  assert.equal(hit.estadual, 22.1);
  assert.equal(hit.chave, 'AA45DF');

  // Different CNPJ misses cache even on same tenant & UF and fetches its own Chave
  const otherCnpj = await getIbptRate(db, {
    tenantId: 't1',
    uf: 'MS',
    ncm: '27111910',
    cnpj: '11222333000181',
    token: 'tok-ms-2',
    fetcher,
    now: new Date('2026-11-12T12:00:00Z')
  });
  assert.equal(apiCalls, 1);
  assert.equal(otherCnpj.chave, 'BB99ZZ');
  assert.equal(otherCnpj.estadual, 23.5);

  // Expired cache triggers refresh
  const refreshed = await getIbptRate(db, {
    tenantId: 't1',
    uf: 'MS',
    ncm: '27111910',
    cnpj: '40740307000143',
    token: 'tok-ms-1',
    fetcher,
    now: new Date('2026-12-05T12:00:00Z')
  });
  assert.equal(apiCalls, 2);
  assert.equal(refreshed.chave, 'NEWKEY');
  assert.equal(refreshed.versao, '26.2.D');
});

test('getIbptRate falls back to stale cache if IBPT API fails during issuance', async () => {
  const db = createMockDb([
    {
      tenant_id: 't1',
      cnpj: '40740307000143',
      uf: 'MS',
      ncm: '27111910',
      ex: 0,
      nacional: 0,
      estadual: 22.1,
      importado: 0,
      municipal: 0,
      chave: 'AA45DF',
      versao: '26.2.C',
      fonte: 'IBPT',
      vigencia_inicio: '2026-10-20',
      vigencia_fim: '2026-11-01',
      updated_at: '2026-10-20T12:00:00Z'
    }
  ]);

  const rate = await getIbptRate(db, {
    tenantId: 't1',
    uf: 'MS',
    ncm: '27111910',
    cnpj: '40740307000143',
    token: 'tok-ms-1',
    fetcher: async () => { throw new Error('network down'); },
    now: new Date('2026-11-12T12:00:00Z')
  });

  assert.equal(rate.estadual, 22.1);
  assert.equal(rate.chave, 'AA45DF');
});

test('applyIbptToDraft applies origin rules (0/3/4/5 vs 1/2/6/7/8), sphere split, Chave and stays idempotent', async () => {
  const db = createMockDb([
    {
      tenant_id: 't1',
      cnpj: '40740307000143',
      uf: 'MS',
      ncm: '27111910',
      ex: 0,
      nacional: 0,
      estadual: 22.1,
      importado: 0,
      municipal: 0,
      chave: 'AA45DF',
      versao: '26.2.C',
      fonte: 'IBPT/empresometro.com.br',
      vigencia_inicio: '2026-10-20',
      vigencia_fim: '2026-11-30',
      updated_at: '2026-11-01T12:00:00Z'
    },
    {
      tenant_id: 't1',
      cnpj: '40740307000143',
      uf: 'MS',
      ncm: '22011000',
      ex: 0,
      nacional: 14.82,
      estadual: 30,
      importado: 25.09,
      municipal: 0,
      chave: 'AA45DF',
      versao: '26.2.C',
      fonte: 'IBPT/empresometro.com.br',
      vigencia_inicio: '2026-10-20',
      vigencia_fim: '2026-11-30',
      updated_at: '2026-11-01T12:00:00Z'
    }
  ]);

  const draft = {
    det: [
      {
        prod: { cProd: 'glp', xProd: 'GLP P13', NCM: '27111910', CFOP: '5656', uCom: 'UN', qCom: 1, vUnCom: 100, vProd: 100 },
        imposto: { ICMS: { ICMSSN102: { orig: 3, CSOSN: '102' } }, PIS: {}, COFINS: {} }
      },
      {
        prod: { cProd: 'agua', xProd: 'AGUA', NCM: '22011000', CFOP: '5102', uCom: 'UN', qCom: 1, vUnCom: 100, vProd: 100 },
        imposto: { ICMS: { ICMSSN102: { orig: 6, CSOSN: '102' } }, PIS: {}, COFINS: {} }
      }
    ],
    total: { ICMSTot: { vProd: 200, vNF: 200 } }
  };

  const cfg = { data: { cnpj: '40740307000143', address: { uf: 'MS' } } };
  const identity = { tenantId: 't1', establishmentId: 'e1' };
  await applyIbptToDraft(db, identity, draft, {
    model: '55',
    cfg,
    now: new Date('2026-11-12T12:00:00Z')
  });

  // GLP: 0% fed + 22.10% est = 22.10
  assert.equal(draft.det[0].imposto.vTotTrib, 22.1);
  // Water with origin 6 (imported without national similar): 25.09% fed + 30.00% est = 55.09
  assert.equal(draft.det[1].imposto.vTotTrib, 55.09);
  // Total = 22.10 + 55.09 = 77.19 (25.09 Federal + 52.10 Estadual)
  assert.equal(draft.total.ICMSTot.vTotTrib, 77.19);
  assert.match(draft.infAdic.infCpl, /25,09 Federal/);
  assert.match(draft.infAdic.infCpl, /52,10 Estadual/);
  assert.match(draft.infAdic.infCpl, /0,00 Municipal/);
  assert.match(draft.infAdic.infCpl, /Chave AA45DF/);

  const infCplOnce = draft.infAdic.infCpl;
  await applyIbptToDraft(db, identity, draft, {
    model: '55',
    cfg,
    now: new Date('2026-11-12T12:00:00Z')
  });
  assert.equal(draft.infAdic.infCpl, infCplOnce);

  // Changing origin recalculates totals and replaces previous IBPT notice without losing custom notes
  draft.det[1].imposto.ICMS.ICMSSN102.orig = 0;
  draft.infAdic.infCpl = 'Obs do cliente. | ' + draft.infAdic.infCpl;
  await applyIbptToDraft(db, identity, draft, {
    model: '55',
    cfg,
    now: new Date('2026-11-12T12:00:00Z')
  });
  assert.equal(draft.det[1].imposto.vTotTrib, 44.82);
  assert.equal(draft.total.ICMSTot.vTotTrib, 66.92);
  assert.match(draft.infAdic.infCpl, /^Obs do cliente\. \| /);
  assert.match(draft.infAdic.infCpl, /14,82 Federal/);
  assert.doesNotMatch(draft.infAdic.infCpl, /25,09 Federal/);
});

test('syncEstablishmentIbpt populates cache for active product NCMs, requires sealed token and reports token errors', async () => {
  const prevKey = process.env.FISCAL_ENCRYPTION_KEY;
  process.env.FISCAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  try {
    const db = createMockDb();
    const identity = { tenantId: 't1', establishmentId: 'e1' };

    await assert.rejects(
      syncEstablishmentIbpt(db, identity, {
        cfg: { data: { cnpj: '40740307000143', ibptToken: 'tok-ms', address: { uf: 'MS' } } },
        fetcher: async () => { throw new Error('should not fetch'); }
      }),
      err => err.code === 'IBPT_TOKEN_REQUIRED'
    );

    const cfg = {
      data: { cnpj: '40740307000143', address: { uf: 'MS' } },
      encrypted_ibpt_token: seal('tok-ms', secretContext(identity, 'ibpt'))
    };

    const res = await syncEstablishmentIbpt(db, identity, {
      cfg,
      fetcher: async url => {
        const u = new URL(url);
        assert.equal(u.searchParams.get('token'), 'tok-ms');
        return {
          ok: true,
          async json() {
            return {
              Codigo: u.searchParams.get('codigo'),
              Nacional: 0,
              Estadual: 22.1,
              Importado: 0,
              Municipal: 0,
              Chave: 'AA45DF',
              Versao: '26.2.C',
              Fonte: 'IBPT/empresometro.com.br',
              VigenciaInicio: '20/10/2026',
              VigenciaFim: '30/11/2026'
            };
          }
        };
      }
    });

    assert.equal(res.syncedCount, 2);
    assert.equal(res.chave, 'AA45DF');
    assert.equal(res.versao, '26.2.C');
    assert.equal(res.vigenciaFim, '2026-11-30');
    assert.equal(db.rows.size, 2);

    await assert.rejects(
      syncEstablishmentIbpt(db, identity, {
        cfg,
        fetcher: async () => ({ ok: false, status: 403, async json() { return {}; } })
      }),
      err => err.code === 'IBPT_UNAUTHORIZED'
    );
  } finally {
    if (prevKey === undefined) delete process.env.FISCAL_ENCRYPTION_KEY;
    else process.env.FISCAL_ENCRYPTION_KEY = prevKey;
  }
});

test('migration 079 enforces RLS, removes stale IBPT-BASE rows and grants bansir_runtime access', () => {
  const sql = readFileSync(new URL('../migrations/postgres/079_ibpt_token_rls_and_validity.sql', import.meta.url), 'utf8');
  assert.match(sql, /DELETE FROM bansir\.ibpt_taxes[\s\S]*IBPT-BASE/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/i);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON bansir\.ibpt_taxes TO bansir_runtime/i);
});

