#!/bin/sh
# Disposable Postgres evidence for dispute lock order.
# The container must already be running and is destroyed by the caller.
# Host-side background sessions are required; docker exec -d does not hold the transaction.
set -eu
container=${1:?container name}
psql() { docker exec "$container" psql -U postgres -d postgres "$@"; }

psql -v ON_ERROR_STOP=1 <<'SQL'
DROP TABLE IF EXISTS engagement_events, dispute_cases, work_engagements, dispute_case_events CASCADE;
CREATE TABLE work_engagements (id uuid PRIMARY KEY, status text NOT NULL);
CREATE TABLE engagement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  note text NOT NULL DEFAULT ''
);
CREATE TABLE dispute_cases (
  id uuid PRIMARY KEY,
  engagement_id uuid NOT NULL,
  is_latest boolean NOT NULL DEFAULT true
);
CREATE TABLE dispute_case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  note text NOT NULL,
  CONSTRAINT dispute_case_events_note_check CHECK (char_length(note) BETWEEN 1 AND 20)
);
CREATE FUNCTION open_dispute_case_on_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE dispute_cases SET is_latest = false WHERE engagement_id = NEW.engagement_id AND is_latest;
  INSERT INTO dispute_cases (id, engagement_id) VALUES (gen_random_uuid(), NEW.engagement_id);
  RETURN NULL;
END $$;
CREATE TRIGGER engagement_events_open_dispute_case
AFTER INSERT ON engagement_events
FOR EACH ROW WHEN (NEW.to_status = 'disputed')
EXECUTE FUNCTION open_dispute_case_on_event();
INSERT INTO work_engagements (id, status) VALUES ('10000000-0000-4000-8000-000000000001', 'delivered');
INSERT INTO dispute_cases (id, engagement_id) VALUES ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001');
SQL

overlap() {
  name=$1
  staff_sql=$2
  psql -c "UPDATE work_engagements SET status = 'delivered' WHERE id = '10000000-0000-4000-8000-000000000001'; UPDATE dispute_cases SET is_latest = true WHERE id = '20000000-0000-4000-8000-000000000002';" >/dev/null
  psql -v ON_ERROR_STOP=1 -c "BEGIN; SELECT id FROM work_engagements WHERE id = '10000000-0000-4000-8000-000000000001' FOR UPDATE; SELECT pg_sleep(8); UPDATE dispute_cases SET is_latest = false WHERE id = '20000000-0000-4000-8000-000000000002'; COMMIT;" >"/tmp/dispute-holder-$name.out" 2>&1 &
  sleep 1
  set +e
  psql -v ON_ERROR_STOP=1 -c "$staff_sql" >"/tmp/dispute-staff-$name.out" 2>&1
  echo "$name staff_exit=$?"
  set -e
  echo "$name holder=$(tr '\n' ' ' < "/tmp/dispute-holder-$name.out")"
  echo "$name staff=$(tr '\n' ' ' < "/tmp/dispute-staff-$name.out")"
  wait || true
}

echo '--- case then engagement deadlocks with a participant who holds the engagement ---'
overlap old "BEGIN; SELECT id FROM dispute_cases WHERE id = '20000000-0000-4000-8000-000000000002' FOR UPDATE; SELECT id FROM work_engagements WHERE id = '10000000-0000-4000-8000-000000000001' FOR UPDATE; COMMIT;"
echo '--- engagement then case completes ---'
overlap fixed "BEGIN; SELECT id FROM work_engagements WHERE id = '10000000-0000-4000-8000-000000000001' FOR UPDATE; SELECT id FROM dispute_cases WHERE id = '20000000-0000-4000-8000-000000000002' FOR UPDATE; COMMIT;"

echo '--- two dispute opens create one case ---'
psql -c "TRUNCATE engagement_events, dispute_cases; UPDATE work_engagements SET status = 'delivered';"
psql -c "BEGIN; UPDATE work_engagements SET status = 'disputed' WHERE id = '10000000-0000-4000-8000-000000000001' AND status = 'delivered'; SELECT pg_sleep(2); INSERT INTO engagement_events (engagement_id, from_status, to_status, note) VALUES ('10000000-0000-4000-8000-000000000001', 'delivered', 'disputed', 'reason'); COMMIT;" >/tmp/dispute-open-a.out 2>&1 &
sleep 0.4
psql -c "UPDATE work_engagements SET status = 'disputed' WHERE id = '10000000-0000-4000-8000-000000000001' AND status = 'delivered';"
wait || true
psql -c "SELECT status FROM work_engagements; SELECT count(*) AS cases FROM dispute_cases; SELECT count(*) AS dispute_events FROM engagement_events WHERE to_status = 'disputed';"

echo '--- failed audit rolls the engagement change back ---'
psql -c "TRUNCATE engagement_events, dispute_cases, dispute_case_events; UPDATE work_engagements SET status = 'disputed'; INSERT INTO dispute_cases (id, engagement_id) VALUES ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001');"
set +e
psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  UPDATE work_engagements SET status = 'delivered' WHERE id = '10000000-0000-4000-8000-000000000001' AND status = 'disputed';
  INSERT INTO engagement_events (engagement_id, from_status, to_status) VALUES ('10000000-0000-4000-8000-000000000001', 'disputed', 'delivered');
  INSERT INTO dispute_case_events (case_id, note) VALUES ('20000000-0000-4000-8000-000000000002', '');
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'audit failed';
END $$;
SQL
set -e
psql -c "SELECT status FROM work_engagements; SELECT count(*) AS events FROM engagement_events; SELECT count(*) AS audits FROM dispute_case_events;"
