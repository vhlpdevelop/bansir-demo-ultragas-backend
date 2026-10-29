-- Subject to storefront RLS; the HTTP route also requires selection in the store.
GRANT SELECT(image_id,image_key,image_mime) ON bansir.products TO bansir_storefront;
