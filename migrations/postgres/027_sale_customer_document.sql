-- Fiscal correction is restricted to the document column; amounts remain immutable.
GRANT UPDATE(customer_document) ON bansir.sales TO bansir_runtime;
