BEGIN;

ALTER TABLE in_app_announcements
  ADD COLUMN audience text NOT NULL DEFAULT 'ALL'
    CHECK (audience IN ('ALL', 'ADMIN', 'DEPARTMENT')),
  ADD COLUMN department_id uuid REFERENCES departments(id) ON DELETE RESTRICT,
  ADD COLUMN attachment_name varchar(120),
  ADD COLUMN attachment_type text CHECK (attachment_type IN ('image/jpeg', 'application/pdf')),
  ADD COLUMN attachment_content bytea,
  ADD COLUMN attachment_sha256 text CHECK (attachment_sha256 IS NULL OR attachment_sha256 ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT announcement_department_scope CHECK (
    (audience = 'DEPARTMENT' AND department_id IS NOT NULL) OR
    (audience <> 'DEPARTMENT' AND department_id IS NULL)
  ),
  ADD CONSTRAINT announcement_attachment_fields CHECK (
    (attachment_content IS NULL AND attachment_name IS NULL AND attachment_type IS NULL AND attachment_sha256 IS NULL) OR
    (attachment_content IS NOT NULL AND attachment_name IS NOT NULL AND attachment_type IS NOT NULL AND attachment_sha256 IS NOT NULL)
  );

CREATE INDEX in_app_announcements_audience_idx
  ON in_app_announcements(audience, department_id, created_at DESC, id DESC);

COMMIT;
