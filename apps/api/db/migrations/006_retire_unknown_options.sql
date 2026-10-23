BEGIN;
-- Retain permanent reference codes for existing records, but remove them from
-- new selections. Historical asset values and source imports stay untouched.
WITH retired AS (
 UPDATE reference_values SET active=false,version=version+1,updated_at=now()
 WHERE kind IN ('CONDITION','RISK') AND code='Unknown' AND active
 RETURNING kind,code,label,version
)
INSERT INTO audit_events(actor_kind,entity_type,action,changes,request_id)
SELECT 'SYSTEM','reference','MASTER_UPDATED',jsonb_build_object(
 'kind',kind,'code',code,
 'reason','Owner requested removal of Unknown options from new selections',
 'before',jsonb_build_object('active',true,'version',version-1),
 'after',jsonb_build_object('active',false,'version',version)
),gen_random_uuid() FROM retired;
COMMIT;
