BEGIN;

ALTER TABLE users
  ADD COLUMN pending_email text,
  ADD CONSTRAINT users_pending_email_valid CHECK (
    pending_email IS NULL OR
    (pending_email = lower(btrim(pending_email)) AND pending_email <> email)
  );

CREATE UNIQUE INDEX users_pending_email_unique
  ON users(pending_email)
  WHERE pending_email IS NOT NULL;

ALTER TABLE auth_tokens DROP CONSTRAINT auth_tokens_purpose_check;
ALTER TABLE auth_tokens ADD CONSTRAINT auth_tokens_purpose_check
  CHECK (purpose IN ('INVITE','VERIFY_EMAIL','RESET_PASSWORD','MFA_CHALLENGE','EMAIL_CHANGE'));

COMMIT;
