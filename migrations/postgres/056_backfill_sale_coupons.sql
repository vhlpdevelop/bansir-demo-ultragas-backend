-- Keep UUIDs and existing coupons; assign only missing historical numbers.
LOCK TABLE bansir.sales,bansir.sale_counters IN ACCESS EXCLUSIVE MODE;
ALTER TABLE bansir.sales NO FORCE ROW LEVEL SECURITY;
ALTER TABLE bansir.sale_counters NO FORCE ROW LEVEL SECURITY;
DO $$ DECLARE u record; base bigint; missing bigint; BEGIN
 FOR u IN SELECT DISTINCT tenant_id,establishment_id FROM bansir.sales WHERE coupon_number IS NULL LOOP
  INSERT INTO bansir.sale_counters(tenant_id,establishment_id) VALUES(u.tenant_id,u.establishment_id) ON CONFLICT DO NOTHING;
  SELECT greatest(c.last_number,coalesce((SELECT max(s.coupon_number) FROM bansir.sales s WHERE s.tenant_id=u.tenant_id AND s.establishment_id=u.establishment_id),0)) INTO base FROM bansir.sale_counters c WHERE c.tenant_id=u.tenant_id AND c.establishment_id=u.establishment_id FOR UPDATE;
  SELECT count(*) INTO missing FROM bansir.sales WHERE tenant_id=u.tenant_id AND establishment_id=u.establishment_id AND coupon_number IS NULL;
  IF base+missing>999999999 THEN RAISE EXCEPTION 'Cupom: contador esgotado para recibos antigos'; END IF;
  WITH numbered AS(SELECT id,row_number() OVER(ORDER BY created_at,id) AS n FROM bansir.sales WHERE tenant_id=u.tenant_id AND establishment_id=u.establishment_id AND coupon_number IS NULL)
  UPDATE bansir.sales s SET coupon_number=base+n.n FROM numbered n WHERE s.tenant_id=u.tenant_id AND s.establishment_id=u.establishment_id AND s.id=n.id;
  UPDATE bansir.sale_counters SET last_number=base+missing WHERE tenant_id=u.tenant_id AND establishment_id=u.establishment_id;
 END LOOP;
END $$;
ALTER TABLE bansir.sales ALTER COLUMN coupon_number SET NOT NULL;
ALTER TABLE bansir.sales FORCE ROW LEVEL SECURITY;
ALTER TABLE bansir.sale_counters FORCE ROW LEVEL SECURITY;
