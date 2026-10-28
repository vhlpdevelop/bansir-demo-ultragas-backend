ALTER TABLE bansir.push_devices ADD COLUMN details jsonb NOT NULL DEFAULT '{}';
GRANT DELETE ON bansir.push_devices TO bansir_runtime;
CREATE FUNCTION bansir.rbac_members() RETURNS TABLE(id uuid,name text,email text,role text,allowed_routes text[],active boolean,owner boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
BEGIN
 IF NOT bansir.can_access_establishment(bansir.tenant_id(),bansir.establishment_id()) OR NOT EXISTS(SELECT 1 FROM bansir.establishment_memberships WHERE tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id() AND user_id=bansir.actor_id() AND establishment_memberships.active AND establishment_memberships.role IN ('admin','superadmin')) THEN RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT u.id,u.name,u.email,m.role,m.allowed_routes,m.active,e.owner_user_id=u.id FROM bansir.establishment_memberships m JOIN bansir.users u ON u.id=m.user_id JOIN bansir.establishments e ON e.id=m.establishment_id AND e.tenant_id=m.tenant_id WHERE m.tenant_id=bansir.tenant_id() AND m.establishment_id=bansir.establishment_id() ORDER BY u.name;
END $$;
CREATE FUNCTION bansir.rbac_save(target uuid,mail text,full_name text,hash text,new_role text,routes text[],enabled boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$
DECLARE result uuid; owner_id uuid;
BEGIN
 PERFORM * FROM bansir.rbac_members();
 SELECT owner_user_id INTO owner_id FROM bansir.establishments WHERE tenant_id=bansir.tenant_id() AND id=bansir.establishment_id() FOR UPDATE;
 IF new_role NOT IN ('admin','gerente_artesao','operador','entregador') THEN RAISE EXCEPTION 'Invalid role'; END IF;
 IF target IS NULL THEN
  IF EXISTS(SELECT 1 FROM bansir.users WHERE email=mail) THEN RAISE EXCEPTION 'Este e-mail já possui uma conta. O vínculo deve ser realizado pela administração do SaaS.' USING ERRCODE='23505'; END IF;
  INSERT INTO bansir.users(email,name,password_hash,must_change_password) VALUES(mail,full_name,hash,true) RETURNING id INTO result;
  INSERT INTO bansir.tenant_memberships(tenant_id,user_id,role,allowed_routes) VALUES(bansir.tenant_id(),result,'operador',ARRAY[]::text[]);
  INSERT INTO bansir.establishment_memberships(tenant_id,establishment_id,user_id,role,allowed_routes,active) VALUES(bansir.tenant_id(),bansir.establishment_id(),result,new_role,routes,enabled);
 ELSE
  IF target=bansir.actor_id() OR target=owner_id THEN RAISE EXCEPTION 'Não é permitido alterar o próprio acesso ou o acesso do proprietário.' USING ERRCODE='42501'; END IF;
  UPDATE bansir.establishment_memberships SET role=new_role,allowed_routes=routes,active=enabled WHERE tenant_id=bansir.tenant_id() AND establishment_id=bansir.establishment_id() AND user_id=target;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found' USING ERRCODE='42501'; END IF;
  result:=target;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION bansir.rbac_members(),bansir.rbac_save(uuid,text,text,text,text,text[],boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.rbac_members(),bansir.rbac_save(uuid,text,text,text,text,text[],boolean) TO bansir_runtime;
CREATE FUNCTION bansir.update_own_profile(full_name text,contact_phone text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,bansir AS $$ UPDATE bansir.users SET name=full_name,phone=contact_phone WHERE id=bansir.actor_id() $$;
REVOKE ALL ON FUNCTION bansir.update_own_profile(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bansir.update_own_profile(text,text) TO bansir_runtime;

