BEGIN;
-- Asset pictures are private application data, never publicly served files.
CREATE TABLE asset_photos(
 asset_id uuid PRIMARY KEY REFERENCES assets(id),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 81920),
 mime_type text NOT NULL DEFAULT 'image/jpeg' CHECK(mime_type='image/jpeg'),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(substring(content FROM 1 FOR 3)=decode('ffd8ff','hex'))
);
COMMIT;
