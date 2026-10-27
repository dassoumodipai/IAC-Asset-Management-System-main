BEGIN;

ALTER TABLE data_transfers
  ADD COLUMN send_emails boolean NOT NULL DEFAULT false;

COMMIT;
