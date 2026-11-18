-- Sale revisions update these fulfillment fields under the existing sales RLS policies.
GRANT UPDATE(delivery_mode, delivery_employee_id, delivery_employee_name, delivery_employee_phone)
ON bansir.sales TO bansir_runtime;
