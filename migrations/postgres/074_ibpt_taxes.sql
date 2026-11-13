CREATE TABLE IF NOT EXISTS bansir.ibpt_taxes (
  tenant_id UUID NOT NULL REFERENCES bansir.tenants(id) ON DELETE CASCADE,
  uf VARCHAR(2) NOT NULL,
  ncm VARCHAR(8) NOT NULL,
  ex INT NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  nacional NUMERIC(6,2) NOT NULL DEFAULT 0,
  estadual NUMERIC(6,2) NOT NULL DEFAULT 0,
  importado NUMERIC(6,2) NOT NULL DEFAULT 0,
  municipal NUMERIC(6,2) NOT NULL DEFAULT 0,
  chave VARCHAR(20) NOT NULL DEFAULT '',
  versao VARCHAR(20) NOT NULL DEFAULT '',
  fonte VARCHAR(50) NOT NULL DEFAULT 'IBPT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, uf, ncm, ex)
);

CREATE INDEX IF NOT EXISTS idx_ibpt_taxes_lookup ON bansir.ibpt_taxes(tenant_id, uf, ncm, ex);

-- Seed de taxas padrão para produtos comuns de gás e água
INSERT INTO bansir.ibpt_taxes (tenant_id, uf, ncm, ex, description, nacional, estadual, importado, municipal, chave, versao, fonte)
SELECT t.id, u.uf, n.ncm, 0, n.description, n.nacional, n.estadual, n.importado, n.municipal, 'IBPT-BASE', '26.1.A', 'IBPT'
FROM bansir.tenants t
CROSS JOIN (VALUES ('MS'), ('MT'), ('SP'), ('GO'), ('PR'), ('RJ'), ('MG')) AS u(uf)
CROSS JOIN (VALUES 
  ('27111910', 'GAS LIQUEFEITO DE PETROLEO GLP P13', 13.45, 17.00, 36.08, 0.00),
  ('22011000', 'AGUA MINERAL NATURAL', 13.45, 17.00, 34.69, 0.00),
  ('73110000', 'VASILHAME BOTIJAO DE GAS', 14.15, 17.00, 24.35, 0.00)
) AS n(ncm, description, nacional, estadual, importado, municipal)
ON CONFLICT (tenant_id, uf, ncm, ex) DO NOTHING;

