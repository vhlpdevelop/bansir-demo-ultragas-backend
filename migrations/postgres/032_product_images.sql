ALTER TABLE bansir.products ADD COLUMN image_id uuid;
ALTER TABLE bansir.products ADD COLUMN image_key text;
ALTER TABLE bansir.products ADD COLUMN image_mime text CHECK(image_mime IN('image/jpeg','image/png','image/webp'));
