BEGIN;
ALTER TABLE reference_values ADD COLUMN version int NOT NULL DEFAULT 1 CHECK(version > 0), ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE departments ADD COLUMN version int NOT NULL DEFAULT 1 CHECK(version > 0), ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE locations ADD COLUMN version int NOT NULL DEFAULT 1 CHECK(version > 0), ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
INSERT INTO reference_values(kind,code,label) SELECT 'STATUS',code,code FROM unnest(ARRAY['Active','In Store','Assigned','Under Repair','Lost','Stolen','Retired','Disposed','Leased','Under Verification','Sold']) AS t(code);
INSERT INTO reference_values(kind,code,label) VALUES
('TICKET_CATEGORY','HARDWARE','Hardware'),('TICKET_CATEGORY','SOFTWARE','Software'),('TICKET_CATEGORY','ACCESS','Access'),('TICKET_CATEGORY','OTHER','Other'),
('TICKET_PRIORITY','LOW','Low'),('TICKET_PRIORITY','MEDIUM','Medium'),('TICKET_PRIORITY','HIGH','High'),
('TICKET_STATUS','OPEN','Open'),('TICKET_STATUS','IN_PROGRESS','In progress'),('TICKET_STATUS','COMPLETED','Completed'),
('DATA_WIPE','Yes','Yes'),('DATA_WIPE','No','No'),('DATA_WIPE','Not Applicable','Not Applicable');
-- Optional vocabulary is bootstrapped only from values already recorded locally.
-- Finance/operational policy choices can then be supplied explicitly in Master Control.
INSERT INTO reference_values(kind,code,label)
SELECT DISTINCT 'DEPRECIATION_METHOD',depreciation_method,depreciation_method FROM assets WHERE depreciation_method IS NOT NULL AND length(btrim(depreciation_method))>0
UNION SELECT DISTINCT 'DISPOSAL_METHOD',disposal_method,disposal_method FROM assets WHERE disposal_method IS NOT NULL AND length(btrim(disposal_method))>0
UNION SELECT DISTINCT 'COMMENT_TYPE',comment_type,comment_type FROM assets WHERE comment_type IS NOT NULL AND length(btrim(comment_type))>0
ON CONFLICT DO NOTHING;
ALTER TABLE reference_values ADD CONSTRAINT fixed_reference_active CHECK(kind NOT IN ('STATUS','TICKET_PRIORITY','TICKET_STATUS','DATA_WIPE') OR active);
ALTER TABLE tickets DROP CONSTRAINT tickets_category_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_category_nonempty CHECK(length(btrim(category)) BETWEEN 1 AND 100);
CREATE FUNCTION preserve_master_code() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.code IS DISTINCT FROM NEW.code OR (TG_TABLE_NAME='reference_values' AND (to_jsonb(OLD)->>'kind') IS DISTINCT FROM (to_jsonb(NEW)->>'kind')) THEN
  RAISE EXCEPTION 'Master codes are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reference_code_immutable BEFORE UPDATE OF kind,code ON reference_values FOR EACH ROW EXECUTE FUNCTION preserve_master_code();
CREATE TRIGGER department_code_immutable BEFORE UPDATE OF code ON departments FOR EACH ROW EXECUTE FUNCTION preserve_master_code();
CREATE TRIGGER location_code_immutable BEFORE UPDATE OF code ON locations FOR EACH ROW EXECUTE FUNCTION preserve_master_code();
COMMIT;
