BEGIN;

ALTER TABLE data_transfers
  DROP CONSTRAINT IF EXISTS data_transfers_raw_rows_check,
  ADD CONSTRAINT data_transfers_raw_rows_check
    CHECK (
      jsonb_typeof(raw_rows) = 'array'
      AND jsonb_array_length(raw_rows) BETWEEN 1 AND 500
    );

COMMIT;
