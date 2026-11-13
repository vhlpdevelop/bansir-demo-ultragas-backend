-- Migration 073: Index for customer sales history and report queue support
CREATE INDEX IF NOT EXISTS idx_sales_customer_history 
ON bansir.sales(tenant_id, establishment_id, customer_id, created_at DESC);

ALTER TABLE bansir.jobs DROP CONSTRAINT IF EXISTS jobs_kind_check;
ALTER TABLE bansir.jobs ADD CONSTRAINT jobs_kind_check CHECK(kind IN ('notification','fiscal','whatsapp','report'));

