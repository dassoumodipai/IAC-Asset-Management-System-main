BEGIN;
CREATE TABLE auth_rate_limits(key_hash text PRIMARY KEY, window_start timestamptz NOT NULL DEFAULT now(), attempts int NOT NULL DEFAULT 0 CHECK(attempts>=0));
CREATE TABLE mfa_enrollments(user_id uuid PRIMARY KEY REFERENCES users(id),secret_ciphertext bytea NOT NULL,expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes');
ALTER TABLE email_deliveries ADD COLUMN lease_token uuid;
ALTER TABLE notification_outbox ADD COLUMN expires_at timestamptz;
CREATE FUNCTION preserve_asset_code() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.asset_code <> OLD.asset_code THEN RAISE EXCEPTION 'Asset ID is immutable' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER immutable_asset_code BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION preserve_asset_code();
CREATE FUNCTION reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'History is append only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER immutable_assignment_events BEFORE UPDATE OR DELETE ON assignment_events FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER immutable_asset_movements BEFORE UPDATE OR DELETE ON asset_movements FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER immutable_ticket_updates BEFORE UPDATE OR DELETE ON ticket_updates FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
CREATE TRIGGER immutable_email_attempts BEFORE UPDATE OR DELETE ON email_attempts FOR EACH ROW EXECUTE FUNCTION reject_history_mutation();
INSERT INTO reference_values(kind,code,label) VALUES
('CATEGORY','IT Equipment','IT Equipment'),('CATEGORY','Furniture','Furniture'),('CATEGORY','Office Equipment','Office Equipment'),('CATEGORY','Electrical','Electrical'),('CATEGORY','Other','Other'),
('ASSET_TYPE','Laptop','Laptop'),('ASSET_TYPE','Desktop','Desktop'),('ASSET_TYPE','Monitor','Monitor'),('ASSET_TYPE','Printer','Printer'),('ASSET_TYPE','Networking','Networking'),('ASSET_TYPE','Other','Other'),
('OWNERSHIP','Owned','Owned'),('OWNERSHIP','Leased','Leased'),('OWNERSHIP','Rented','Rented'),('OWNERSHIP','Donated','Donated'),
('CONDITION','New','New'),('CONDITION','Good','Good'),('CONDITION','Fair','Fair'),('CONDITION','Poor','Poor'),('CONDITION','Unknown','Unknown'),
('RISK','Low','Low'),('RISK','Medium','Medium'),('RISK','High','High'),('RISK','Unknown','Unknown');
INSERT INTO notification_groups(code) VALUES('ADMIN'),('IT');
COMMIT;
