BEGIN;
CREATE TABLE data_transfers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL REFERENCES users(id),
 module text NOT NULL,
 source_filename text NOT NULL,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 raw_rows jsonb NOT NULL CHECK(jsonb_typeof(raw_rows)='array' AND jsonb_array_length(raw_rows) BETWEEN 1 AND 50),
 reason text NOT NULL,
 preview jsonb NOT NULL,
 state text NOT NULL DEFAULT 'PREVIEWED' CHECK(state IN ('PREVIEWED','COMMITTED')),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
 committed_at timestamptz,
 receipt jsonb,
 CHECK((state='PREVIEWED' AND committed_at IS NULL AND receipt IS NULL) OR (state='COMMITTED' AND committed_at IS NOT NULL AND receipt IS NOT NULL))
);
CREATE INDEX data_transfers_actor ON data_transfers(actor_id,created_at);
CREATE FUNCTION protect_data_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Transfer provenance cannot be deleted'; END IF;
 IF OLD.state='COMMITTED' OR (to_jsonb(NEW)-ARRAY['state','committed_at','receipt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','committed_at','receipt']) THEN
  RAISE EXCEPTION 'Transfer provenance is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_data_transfer BEFORE UPDATE OR DELETE ON data_transfers FOR EACH ROW EXECUTE FUNCTION protect_data_transfer();
COMMIT;
