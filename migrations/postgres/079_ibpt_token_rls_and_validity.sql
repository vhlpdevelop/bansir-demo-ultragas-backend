-- Adiciona suporte a CNPJ emitente, vigência real da tabela IBPT, isolamento RLS e permissões para bansir_runtime.

DELETE FROM bansir.ibpt_taxes
WHERE chave = 'IBPT-BASE' AND versao = '26.1.A';

ALTER TABLE bansir.ibpt_taxes
  ADD COLUMN IF NOT EXISTS cnpj VARCHAR(14) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tipo SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vigencia_inicio DATE,
  ADD COLUMN IF NOT EXISTS vigencia_fim DATE;

ALTER TABLE bansir.ibpt_taxes DROP CONSTRAINT IF EXISTS ibpt_taxes_pkey;
ALTER TABLE bansir.ibpt_taxes ADD CONSTRAINT ibpt_taxes_pkey PRIMARY KEY (tenant_id, cnpj, uf, ncm, ex);

DROP INDEX IF EXISTS bansir.idx_ibpt_taxes_lookup;
CREATE INDEX idx_ibpt_taxes_lookup ON bansir.ibpt_taxes(tenant_id, cnpj, uf, ncm, ex);

ALTER TABLE bansir.ibpt_taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE bansir.ibpt_taxes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON bansir.ibpt_taxes;
CREATE POLICY tenant_isolation ON bansir.ibpt_taxes TO bansir_runtime
  USING (bansir.can_access_tenant(tenant_id))
  WITH CHECK (bansir.can_access_tenant(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bansir.ibpt_taxes TO bansir_runtime;

