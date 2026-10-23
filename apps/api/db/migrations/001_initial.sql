-- Reference PostgreSQL DDL. Review and execute in a disposable database first.
BEGIN;
CREATE TABLE roles(code text PRIMARY KEY CHECK(code IN ('ADMIN','EMPLOYEE','IT_ADMIN')));
INSERT INTO roles VALUES ('ADMIN'),('EMPLOYEE'),('IT_ADMIN');
CREATE TABLE users(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text UNIQUE NOT NULL CHECK(email=lower(btrim(email))),
 display_name text NOT NULL,employee_reference text,password_hash text,
 state text NOT NULL DEFAULT 'INVITED' CHECK(state IN ('INVITED','ACTIVE','DISABLED')),
 email_verified_at timestamptz,portal_accepted_at timestamptz,portal_notice_version text,
 mfa_secret_ciphertext bytea,mfa_enrolled_at timestamptz,mfa_last_counter bigint,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),version int NOT NULL DEFAULT 1);
CREATE TABLE user_roles(user_id uuid REFERENCES users(id),role_code text REFERENCES roles(code),granted_by uuid REFERENCES users(id),granted_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,role_code));
CREATE TABLE approved_emails(email text PRIMARY KEY CHECK(email=lower(btrim(email))),approved_by uuid REFERENCES users(id),approved_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sessions(id_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),csrf_hash text NOT NULL,scope text NOT NULL DEFAULT 'APP' CHECK(scope IN ('APP','MFA_ENROLLMENT')),created_at timestamptz NOT NULL DEFAULT now(),last_seen_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,mfa_verified_at timestamptz,revoked_at timestamptz);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE auth_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),purpose text NOT NULL CHECK(purpose IN ('INVITE','VERIFY_EMAIL','RESET_PASSWORD','MFA_CHALLENGE')),token_hash text UNIQUE NOT NULL,expires_at timestamptz NOT NULL,consumed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE mfa_recovery_codes(user_id uuid REFERENCES users(id),code_hash text NOT NULL,used_at timestamptz,PRIMARY KEY(user_id,code_hash));
CREATE TABLE reference_values(kind text NOT NULL,code text NOT NULL,label text NOT NULL,active boolean NOT NULL DEFAULT true,PRIMARY KEY(kind,code));
CREATE TABLE departments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text UNIQUE NOT NULL,name text UNIQUE NOT NULL,active boolean NOT NULL DEFAULT true);
CREATE TABLE locations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text UNIQUE NOT NULL,site text,building text,floor text,room text,active boolean NOT NULL DEFAULT true);
CREATE TABLE import_batches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source_sha256 text UNIQUE NOT NULL,source_filename text NOT NULL,exported_at timestamptz,state text NOT NULL CHECK(state IN ('STAGED','REVIEWED','COMMITTED')),created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),reconciliation jsonb NOT NULL DEFAULT '{}',version int NOT NULL DEFAULT 1);
CREATE TABLE import_rows(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES import_batches(id),row_number int NOT NULL,raw_fields jsonb NOT NULL,normalized_fields jsonb,issues jsonb NOT NULL DEFAULT '[]',state text NOT NULL CHECK(state IN ('QUARANTINED','ACCEPTED','PROMOTED')),UNIQUE(batch_id,row_number));
CREATE SEQUENCE asset_number_seq;
CREATE TABLE assets(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),asset_code text UNIQUE NOT NULL CHECK(asset_code ~ '^IAC-IT-[0-9]{6}$'),
 category text NOT NULL,asset_type text NOT NULL,description text NOT NULL,manufacturer text,model text,serial_number text,barcode text,
 configuration text,graphics text,ownership_type text NOT NULL,department_id uuid REFERENCES departments(id),location_id uuid REFERENCES locations(id),asset_owner text,
 status text NOT NULL CHECK(status IN ('Active','In Store','Assigned','Under Repair','Lost','Stolen','Retired','Disposed','Leased','Under Verification','Sold')),
 condition text NOT NULL,risk_level text NOT NULL,warranty_expiry date,amc_applies boolean NOT NULL DEFAULT false,amc_expiry date,
 purchase_date date,purchase_cost numeric(14,2) CHECK(purchase_cost>=0),currency char(3) NOT NULL DEFAULT 'INR',residual_value numeric(14,2) CHECK(residual_value>=0),depreciation_method text,useful_life_years int CHECK(useful_life_years>0),finance_pending boolean NOT NULL DEFAULT true,
 invoice_number text,supplier text,insurance_policy_number text,insurance_expiry date,last_audit_date date,next_audit_date date,
 disposal_date date,disposal_method text,disposal_reference text,data_wipe_required text CHECK(data_wipe_required IN ('Yes','No','Not Applicable')),remarks text,comment_type text,
 legacy_metadata jsonb NOT NULL DEFAULT '{}',import_row_id uuid UNIQUE REFERENCES import_rows(id),created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),version int NOT NULL DEFAULT 1,
 CHECK(residual_value IS NULL OR (purchase_cost IS NOT NULL AND residual_value<=purchase_cost)),
 CHECK(amc_applies OR amc_expiry IS NULL),CHECK(warranty_expiry IS NULL OR purchase_date IS NULL OR warranty_expiry>=purchase_date),
 CHECK(next_audit_date IS NULL OR last_audit_date IS NULL OR next_audit_date>last_audit_date),
 CHECK(status NOT IN ('Retired','Disposed','Sold') OR (disposal_date IS NOT NULL AND disposal_reference IS NOT NULL AND length(btrim(disposal_reference))>0)));
CREATE INDEX assets_filters ON assets(status,category,department_id,id);
CREATE TABLE assignments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),asset_id uuid NOT NULL REFERENCES assets(id),user_id uuid NOT NULL REFERENCES users(id),assigned_by uuid NOT NULL REFERENCES users(id),assigned_at timestamptz NOT NULL DEFAULT now(),ended_at timestamptz,ended_by uuid REFERENCES users(id),
 acknowledgement text NOT NULL DEFAULT 'PENDING' CHECK(acknowledgement IN ('PENDING','ACCEPTED','DISPUTED')),acknowledged_at timestamptz,dispute_reason text,handover_note text,version int NOT NULL DEFAULT 1,
 CHECK(ended_at IS NULL OR ended_at>=assigned_at),
 CHECK((acknowledgement='PENDING' AND acknowledged_at IS NULL) OR (acknowledgement<>'PENDING' AND acknowledged_at IS NOT NULL)),
 CHECK(acknowledgement<>'DISPUTED' OR (dispute_reason IS NOT NULL AND length(btrim(dispute_reason))>0)));
CREATE UNIQUE INDEX one_open_assignment ON assignments(asset_id) WHERE ended_at IS NULL;
CREATE INDEX assignments_user ON assignments(user_id,ended_at,id);
CREATE TABLE assignment_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),assignment_id uuid NOT NULL REFERENCES assignments(id),actor_id uuid NOT NULL REFERENCES users(id),kind text NOT NULL,details jsonb NOT NULL DEFAULT '{}',occurred_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE asset_movements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),asset_id uuid NOT NULL REFERENCES assets(id),kind text NOT NULL CHECK(kind IN ('ASSIGN','RETURN','REASSIGN','RELOCATE','STATUS_CHANGE')),from_assignment_id uuid REFERENCES assignments(id),to_assignment_id uuid REFERENCES assignments(id),from_location_id uuid REFERENCES locations(id),to_location_id uuid REFERENCES locations(id),reason text NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),occurred_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE tickets(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ticket_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,reporter_id uuid NOT NULL REFERENCES users(id),asset_id uuid REFERENCES assets(id),assignment_at_creation_id uuid REFERENCES assignments(id),related_ticket_id uuid REFERENCES tickets(id),
 subject varchar(160) NOT NULL,description varchar(5000) NOT NULL,category text NOT NULL CHECK(category IN ('HARDWARE','SOFTWARE','ACCESS','OTHER')),priority text NOT NULL CHECK(priority IN ('LOW','MEDIUM','HIGH')),status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','IN_PROGRESS','COMPLETED')),
 owner_id uuid REFERENCES users(id),resolution varchar(5000),completed_by uuid REFERENCES users(id),completed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),version int NOT NULL DEFAULT 1,
 CHECK((status='COMPLETED' AND completed_at IS NOT NULL AND completed_by IS NOT NULL AND resolution IS NOT NULL AND length(btrim(resolution))>0) OR (status<>'COMPLETED' AND completed_at IS NULL AND completed_by IS NULL AND resolution IS NULL)));
CREATE INDEX tickets_queue ON tickets(status,priority,created_at,id);
CREATE INDEX tickets_reporter ON tickets(reporter_id,created_at,id);
CREATE TABLE ticket_updates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ticket_id uuid NOT NULL REFERENCES tickets(id),actor_id uuid NOT NULL REFERENCES users(id),kind text NOT NULL CHECK(kind IN ('CREATED','COMMENT','OWNER_CHANGED','STATUS_CHANGED')),visibility text NOT NULL CHECK(visibility IN ('PUBLIC','INTERNAL')),body varchar(5000),old_status text,new_status text,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ticket_updates_timeline ON ticket_updates(ticket_id,created_at,id);
CREATE TABLE audit_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid REFERENCES users(id),actor_kind text NOT NULL CHECK(actor_kind IN ('USER','SYSTEM')),entity_type text NOT NULL,entity_id uuid,action text NOT NULL,changes jsonb NOT NULL DEFAULT '{}',request_id uuid NOT NULL,occurred_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX audit_entity ON audit_events(entity_type,entity_id,occurred_at,id);
CREATE TABLE notification_groups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text UNIQUE NOT NULL CHECK(code IN ('ADMIN','IT')),enabled boolean NOT NULL DEFAULT true);
CREATE TABLE notification_recipients(group_id uuid REFERENCES notification_groups(id),email text NOT NULL CHECK(email=lower(btrim(email))),verified_at timestamptz,PRIMARY KEY(group_id,email));
CREATE TABLE notification_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_key text UNIQUE NOT NULL,template text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE email_deliveries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),outbox_id uuid NOT NULL REFERENCES notification_outbox(id),recipient text NOT NULL,state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','LEASED','ACCEPTED','DEAD')),attempts int NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),leased_until timestamptz,provider_message_id text,last_error_code text,accepted_at timestamptz,UNIQUE(outbox_id,recipient));
CREATE INDEX delivery_work ON email_deliveries(next_attempt_at) WHERE state IN ('PENDING','LEASED');
CREATE TABLE email_attempts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),delivery_id uuid NOT NULL REFERENCES email_deliveries(id),attempt_number int NOT NULL,result_code text NOT NULL,occurred_at timestamptz NOT NULL DEFAULT now(),UNIQUE(delivery_id,attempt_number));
CREATE TABLE idempotency_keys(user_id uuid NOT NULL REFERENCES users(id),route text NOT NULL,key text NOT NULL,request_hash text NOT NULL,response_code int,response_body jsonb,expires_at timestamptz NOT NULL,PRIMARY KEY(user_id,route,key));
-- Services enforce current roles/active state, reference kind/code validity,
-- immutable asset_code, future dates, version increments, legal state transitions,
-- final Admin protection and custody/status consistency under row locks.
-- Bootstrap operator advances sequence past imported numeric suffixes.
-- Deploy separate migration owner and runtime roles. Runtime must not own tables.
-- Runtime has no DELETE on assets/history or UPDATE/DELETE on append-only events.
COMMIT;
