ALTER TABLE bansir.fiscal_documents DROP CONSTRAINT fiscal_documents_status_check;
ALTER TABLE bansir.fiscal_documents ADD CHECK(status IN('queued','submitting','unknown','authorized','rejected','manual_review','cancelled'));
CREATE TABLE bansir.fiscal_cancellations(
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,document_id uuid NOT NULL,request_key uuid NOT NULL,reason text NOT NULL,event_payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','submitting','unknown','accepted','rejected','manual_review')),protocol text,return_code text,response_data jsonb,requested_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,document_id),FOREIGN KEY(tenant_id,establishment_id,document_id) REFERENCES bansir.fiscal_documents(tenant_id,establishment_id,id)
);
ALTER TABLE bansir.fiscal_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bansir.fiscal_cancellations FORCE ROW LEVEL SECURITY;
CREATE POLICY unit_cancel ON bansir.fiscal_cancellations TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id));
CREATE POLICY worker_cancel ON bansir.fiscal_cancellations TO bansir_worker USING(tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id()) WITH CHECK(tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id());
GRANT SELECT,INSERT ON bansir.fiscal_cancellations TO bansir_runtime;
GRANT SELECT,UPDATE ON bansir.fiscal_cancellations TO bansir_worker;
GRANT UPDATE(updated_at) ON bansir.fiscal_documents TO bansir_runtime;
