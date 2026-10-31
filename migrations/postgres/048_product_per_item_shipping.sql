CREATE OR REPLACE FUNCTION bansir.guard_product_delivery_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed boolean; fee_changed boolean; owner_ok boolean; privileged boolean; BEGIN
 privileged:=EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND(rolsuper OR rolbypassrls));
 owner_ok:=EXISTS(SELECT 1 FROM bansir.establishments WHERE tenant_id=NEW.tenant_id AND id=NEW.establishment_id AND owner_user_id=bansir.actor_id());
 changed:=(NEW.fulfillment_pricing-'deliveryFeePerUnit')<>'{}'::jsonb OR NEW.gas_do_povo OR NEW.gas_do_povo_delivery;
 fee_changed:=NEW.fulfillment_pricing ? 'deliveryFeePerUnit';
 IF TG_OP='UPDATE' THEN
 changed:=((OLD.fulfillment_pricing-'deliveryFeePerUnit'),OLD.gas_do_povo,OLD.gas_do_povo_delivery) IS DISTINCT FROM ((NEW.fulfillment_pricing-'deliveryFeePerUnit'),NEW.gas_do_povo,NEW.gas_do_povo_delivery);
 fee_changed:=(OLD.fulfillment_pricing->'deliveryFeePerUnit') IS DISTINCT FROM (NEW.fulfillment_pricing->'deliveryFeePerUnit');
 END IF;
 IF changed AND NOT privileged AND NOT owner_ok THEN RAISE EXCEPTION 'Somente o dono pode configurar preços de entrega e Gás do Povo' USING ERRCODE='42501';END IF;
 IF fee_changed AND NOT privileged AND NOT owner_ok AND NOT EXISTS(SELECT 1 FROM bansir.establishment_memberships WHERE tenant_id=NEW.tenant_id AND establishment_id=NEW.establishment_id AND user_id=bansir.actor_id() AND active AND role IN('admin','superadmin')) THEN RAISE EXCEPTION 'Somente administrador pode configurar frete por unidade' USING ERRCODE='42501';END IF;
 RETURN NEW;
END $$;
