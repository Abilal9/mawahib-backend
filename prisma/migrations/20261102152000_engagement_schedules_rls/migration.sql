-- Transaction-local timeouts. The schema engine sends this file as one
-- script. SET LOCAL ends when the transaction commits or rolls back, so
-- the settings do not remain for a later migration on a reused session.
-- The only catalog change is enabling RLS. Do not FORCE RLS.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.engagement_schedules ENABLE ROW LEVEL SECURITY;

COMMIT;
