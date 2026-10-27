CREATE TABLE bansir.customers (
 tenant_id uuid NOT NULL, establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),
 name text NOT NULL,document text NOT NULL DEFAULT '',phone text NOT NULL DEFAULT '',address text NOT NULL DEFAULT '',active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id) REFERENCES bansir.establishments(tenant_id,id)
);
CREATE TABLE bansir.cash_sessions (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),user_id uuid NOT NULL,
 opening_cents bigint NOT NULL CHECK(opening_cents BETWEEN 0 AND 1000000000),opened_at timestamptz NOT NULL DEFAULT now(),
 closed_at timestamptz,counted_cents bigint CHECK(counted_cents BETWEEN 0 AND 1000000000),expected_cents bigint,difference_cents bigint,closing_note text,
 PRIMARY KEY(tenant_id,establishment_id,id),FOREIGN KEY(tenant_id,establishment_id,user_id) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id)
);
CREATE UNIQUE INDEX one_open_cash_per_operator ON bansir.cash_sessions(tenant_id,establishment_id,user_id) WHERE closed_at IS NULL;
CREATE TABLE bansir.sales (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),request_key uuid NOT NULL,request_hash text NOT NULL,
 cash_session_id uuid NOT NULL,created_by uuid NOT NULL,seller_name text NOT NULL,
 customer_id uuid,customer_name text NOT NULL DEFAULT '',customer_document text NOT NULL DEFAULT '',customer_phone text NOT NULL DEFAULT '',
 subtotal_cents bigint NOT NULL CHECK(subtotal_cents>0),discount_cents bigint NOT NULL CHECK(discount_cents>=0 AND discount_cents<subtotal_cents),
 delivery_fee_cents bigint NOT NULL CHECK(delivery_fee_cents>=0),total_cents bigint NOT NULL CHECK(total_cents=subtotal_cents-discount_cents+delivery_fee_cents AND total_cents<=1000000000),
 delivery_mode text NOT NULL CHECK(delivery_mode IN('pickup','delivery')),delivery_address text NOT NULL DEFAULT '',
 payment_term text NOT NULL CHECK(payment_term IN('immediate','delivery','credit')),due_date date,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,establishment_id,id),UNIQUE(tenant_id,establishment_id,request_key),
 FOREIGN KEY(tenant_id,establishment_id,cash_session_id) REFERENCES bansir.cash_sessions(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,created_by) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id),
 FOREIGN KEY(tenant_id,establishment_id,customer_id) REFERENCES bansir.customers(tenant_id,establishment_id,id)
);
CREATE TABLE bansir.sale_items (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,sale_id uuid NOT NULL,product_id uuid NOT NULL,
 position integer NOT NULL,product_name text NOT NULL,barcode text NOT NULL,unit text NOT NULL,ncm text NOT NULL,
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),unit_price_cents bigint NOT NULL CHECK(unit_price_cents>0),unit_cost_cents bigint NOT NULL CHECK(unit_cost_cents>=0),
 gross_cents bigint NOT NULL CHECK(gross_cents=quantity*unit_price_cents),discount_cents bigint NOT NULL CHECK(discount_cents BETWEEN 0 AND gross_cents),
 PRIMARY KEY(tenant_id,establishment_id,sale_id,position),UNIQUE(tenant_id,establishment_id,sale_id,product_id),
 FOREIGN KEY(tenant_id,establishment_id,sale_id) REFERENCES bansir.sales(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,product_id) REFERENCES bansir.products(tenant_id,establishment_id,id)
);
CREATE TABLE bansir.sale_payments (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),sale_id uuid NOT NULL,cash_session_id uuid NOT NULL,
 request_key uuid NOT NULL,request_hash text NOT NULL,paid_by uuid NOT NULL,method text NOT NULL CHECK(method IN('cash','pix','credit_card','debit_card')),
 amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 1 AND 1000000000),received_cents bigint NOT NULL CHECK(received_cents>=amount_cents),
 reference text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,id),UNIQUE(tenant_id,establishment_id,request_key),
 FOREIGN KEY(tenant_id,establishment_id,sale_id) REFERENCES bansir.sales(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,cash_session_id) REFERENCES bansir.cash_sessions(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,paid_by) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id)
);
CREATE TABLE bansir.sale_cancellations (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,sale_id uuid NOT NULL,user_id uuid NOT NULL,reason text NOT NULL,
 refund_reference text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,establishment_id,sale_id),
 FOREIGN KEY(tenant_id,establishment_id,sale_id) REFERENCES bansir.sales(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,user_id) REFERENCES bansir.establishment_memberships(tenant_id,establishment_id,user_id)
);
CREATE TABLE bansir.cash_movements (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,id uuid NOT NULL DEFAULT gen_random_uuid(),cash_session_id uuid NOT NULL,
 request_key uuid NOT NULL,request_hash text NOT NULL,payment_id uuid,kind text NOT NULL CHECK(kind IN('sale','refund','deposit','withdrawal')),
 amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 1 AND 1000000000),reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,establishment_id,id),UNIQUE(tenant_id,establishment_id,request_key),UNIQUE(tenant_id,establishment_id,payment_id,kind),
 FOREIGN KEY(tenant_id,establishment_id,cash_session_id) REFERENCES bansir.cash_sessions(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,payment_id) REFERENCES bansir.sale_payments(tenant_id,establishment_id,id)
);
CREATE TABLE bansir.sale_fiscal_links (
 tenant_id uuid NOT NULL,establishment_id uuid NOT NULL,sale_id uuid NOT NULL,document_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,establishment_id,sale_id),UNIQUE(tenant_id,establishment_id,document_id),
 FOREIGN KEY(tenant_id,establishment_id,sale_id) REFERENCES bansir.sales(tenant_id,establishment_id,id),
 FOREIGN KEY(tenant_id,establishment_id,document_id) REFERENCES bansir.fiscal_documents(tenant_id,establishment_id,id)
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['customers','cash_sessions','sales','sale_items','sale_payments','sale_cancellations','cash_movements','sale_fiscal_links'] LOOP
  EXECUTE format('ALTER TABLE bansir.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE bansir.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY unit_pdv ON bansir.%I TO bansir_runtime USING(bansir.can_access_establishment(tenant_id,establishment_id)) WITH CHECK(bansir.can_access_establishment(tenant_id,establishment_id))',tab);
 END LOOP;
END $$;
GRANT SELECT,INSERT ON bansir.sales,bansir.sale_items,bansir.sale_payments,bansir.sale_cancellations,bansir.cash_movements,bansir.sale_fiscal_links TO bansir_runtime;
GRANT SELECT,INSERT,UPDATE ON bansir.customers,bansir.cash_sessions TO bansir_runtime;
CREATE INDEX sale_history ON bansir.sales(tenant_id,establishment_id,created_at DESC);
CREATE INDEX sale_payment_totals ON bansir.sale_payments(tenant_id,establishment_id,sale_id);
CREATE INDEX cash_movement_totals ON bansir.cash_movements(tenant_id,establishment_id,cash_session_id);
