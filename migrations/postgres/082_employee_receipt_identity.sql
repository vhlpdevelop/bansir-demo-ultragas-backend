ALTER TABLE bansir.employees
 ADD COLUMN cpf text NOT NULL DEFAULT '' CHECK (cpf ~ '^([0-9]{11})?$'),
 ADD COLUMN registration text NOT NULL DEFAULT '' CHECK (length(registration) <= 40);
