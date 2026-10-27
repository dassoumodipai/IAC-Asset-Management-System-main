BEGIN;

CREATE TABLE in_app_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(100) NOT NULL,
  message varchar(500) NOT NULL,
  path varchar(300) NOT NULL CHECK (path IN ('/dashboard','/assets','/tickets','/notifications')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX in_app_announcements_created_idx ON in_app_announcements(created_at DESC, id DESC);

CREATE TABLE in_app_announcement_reads (
  announcement_id uuid NOT NULL REFERENCES in_app_announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id,user_id)
);
CREATE INDEX in_app_announcement_reads_user_idx ON in_app_announcement_reads(user_id,announcement_id);

COMMIT;
