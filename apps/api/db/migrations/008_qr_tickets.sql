BEGIN;
CREATE TABLE ticket_photos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 ticket_id uuid NOT NULL REFERENCES tickets(id),
 position smallint NOT NULL CHECK(position BETWEEN 1 AND 3),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 409600),
 mime_type text NOT NULL DEFAULT 'image/jpeg' CHECK(mime_type='image/jpeg'),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 width int NOT NULL,
 height int NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(ticket_id,position)
);
CREATE TABLE asset_label_prints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 asset_id uuid NOT NULL REFERENCES assets(id),
 layout text NOT NULL CHECK(layout IN ('A4_24','A4_14','THERMAL_50x25')),
 printed_by uuid NOT NULL REFERENCES users(id),
 printed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX asset_label_prints_asset ON asset_label_prints(asset_id,printed_at DESC);
CREATE INDEX assets_code_lower ON assets(lower(asset_code));
COMMIT;
