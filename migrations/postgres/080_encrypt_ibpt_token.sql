-- Armazena o Token IBPT de forma cifrada em coluna dedicada, removendo eventual campo legado de data.

ALTER TABLE bansir.fiscal_settings
  ADD COLUMN IF NOT EXISTS encrypted_ibpt_token text;

UPDATE bansir.fiscal_settings
SET data = data - 'ibptToken'
WHERE data ? 'ibptToken';

