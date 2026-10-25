BEGIN;

ALTER TABLE users
  ADD COLUMN designation text,
  ADD COLUMN department_id uuid REFERENCES departments(id);

ALTER TABLE users
  ADD CONSTRAINT users_designation_valid
  CHECK (designation IS NULL OR (length(btrim(designation)) BETWEEN 1 AND 120));

COMMIT;
