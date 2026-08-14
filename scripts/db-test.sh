#!/usr/bin/env bash
# Apply every migration to a throwaway Postgres and run the SQL test suites
# against it, one fresh database per suite.
#
# The invariants in 0013, 0020 and 0021 are enforced by RLS policies, column
# grants, check constraints and security-definer functions. None of that is
# reachable from vitest, and none of it should be verified by reading the SQL
# and nodding — a revoked grant either stops a direct PostgREST call or it
# doesn't. So: a real cluster, a shim for the three Supabase API roles and
# auth.uid(), and assertions that impersonate a member, a non-member and a
# signed-out visitor.
#
#   npm run db:test
#   scripts/db-test.sh supabase/tests/picks.sql
#
# Needs local Postgres binaries (/usr/lib/postgresql/*/bin or on PATH). Nothing
# touches a real project: the cluster lives in a temp dir and is destroyed on
# exit.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SUITES=("$@")
if [ ${#SUITES[@]} -eq 0 ]; then
  SUITES=("$REPO"/supabase/tests/*.sql)
fi
# The shim is applied before every suite, never as a suite of its own.
FILTERED=()
for t in "${SUITES[@]}"; do
  case "$(basename "$t")" in 00_shim.sql) ;; *) FILTERED+=("$t") ;; esac
done
[ ${#FILTERED[@]} -gt 0 ] || { echo "No test suites given." >&2; exit 1; }

PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
if [ -z "$PGBIN" ]; then
  command -v initdb >/dev/null || { echo "No Postgres binaries found." >&2; exit 1; }
  PGBIN="$(dirname "$(command -v initdb)")"
fi

TMP="$(mktemp -d)"
# initdb refuses to run as root, so hand the cluster to the postgres user.
RUNAS=""
if [ "$(id -u)" = 0 ]; then
  id postgres >/dev/null 2>&1 || { echo "Running as root with no postgres user." >&2; exit 1; }
  RUNAS="postgres"
  chmod 755 "$TMP"
fi
mkdir -p "$TMP/data" "$TMP/sock"
: > "$TMP/pg.log"
[ -n "$RUNAS" ] && chown -R "$RUNAS" "$TMP/data" "$TMP/sock" "$TMP/pg.log"

run() { if [ -n "$RUNAS" ]; then su "$RUNAS" -c "$1"; else sh -c "$1"; fi; }

# --- pg_cron / pg_net stand-ins ---------------------------------------------
# 0043 and 0044 open with `create extension if not exists pg_cron` (and pg_net),
# and neither ships with stock Postgres — they are Supabase-provisioned. So
# from the day 0043 landed, this runner aborted on migration 43 of 45 and NOT
# ONE assertion ran. `npm run db:test` looked like a broken environment rather
# than a broken tool, which is why it sat.
#
# CREATE EXTENSION reads the installation's sharedir and PG16 has no override
# for it, so the only way to satisfy those two lines offline is to put a stub
# control file there. It is written only if the real extension is absent, and
# removed on exit.
#
# The stubs are deliberately inert: cron.schedule records the job and never
# runs it, net.http_post returns an id and sends nothing. That is the right
# fidelity — what these suites verify is the SCHEMA the migrations build, and a
# test cluster that started making outbound HTTP calls on a timer would be a
# defect in its own right.
EXTDIR="$("$PGBIN/pg_config" --sharedir 2>/dev/null)/extension"
STUBBED=()
stub_extension() {
  local name="$1" schema="$2" body="$3"
  [ -f "$EXTDIR/$name.control" ] && return 0
  if [ ! -w "$EXTDIR" ]; then
    echo "-- cannot stub $name: $EXTDIR is not writable." >&2
    echo "-- Install $name, or run this as a user who can write there." >&2
    echo "-- Refusing to skip migrations silently — 0043/0044 need it." >&2
    exit 1
  fi
  printf "comment = 'offline stub'\ndefault_version = '1.0'\nrelocatable = false\nschema = %s\n" \
    "$schema" > "$EXTDIR/$name.control"
  printf '%s\n' "$body" > "$EXTDIR/$name--1.0.sql"
  STUBBED+=("$name")
}

cleanup() {
  run "$PGBIN/pg_ctl -D $TMP/data -m immediate stop" >/dev/null 2>&1 || true
  for e in ${STUBBED+"${STUBBED[@]}"}; do
    rm -f "$EXTDIR/$e.control" "$EXTDIR/$e--1.0.sql"
  done
  rm -rf "$TMP"
}
trap cleanup EXIT

stub_extension pg_cron cron "
create table job (
  jobid    bigserial primary key,
  schedule text,
  command  text,
  jobname  text unique
);
create table job_run_details (
  jobid    bigint,
  runid    bigserial primary key,
  status   text,
  end_time timestamptz
);
create function schedule(job_name text, schedule text, command text) returns bigint
language sql as \$\$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  returning jobid;
\$\$;
create function schedule(schedule text, command text) returns bigint
language sql as \$\$
  insert into cron.job (jobname, schedule, command) values (schedule, schedule, command)
  returning jobid;
\$\$;
-- Raises when the job is absent, which is what the migrations' exception
-- handlers are written against (0044:43-48 relies on it).
create function unschedule(job_name text) returns boolean
language plpgsql as \$\$
declare n integer;
begin
  delete from cron.job where jobname = job_name;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'could not find valid entry for job %', job_name; end if;
  return true;
end;
\$\$;
"

stub_extension pg_net net "
create function http_post(url text, body jsonb default '{}'::jsonb,
                          params jsonb default '{}'::jsonb,
                          headers jsonb default '{}'::jsonb,
                          timeout_milliseconds integer default 5000) returns bigint
language sql as \$\$ select 0::bigint \$\$;
"

run "$PGBIN/initdb -U postgres -A trust -D $TMP/data" >/dev/null
run "$PGBIN/pg_ctl -D $TMP/data -o '-k $TMP/sock -c listen_addresses=\"\"' -l $TMP/pg.log -w start" >/dev/null

PSQL=(psql -h "$TMP/sock" -U postgres -v ON_ERROR_STOP=1 --no-psqlrc)
MIGRATIONS=("$REPO"/supabase/migrations/*.sql)
echo "-- ${#MIGRATIONS[@]} migrations, ${#FILTERED[@]} suite(s)"

out="$(mktemp)"
status=0
n=0
for t in "${FILTERED[@]}"; do
  n=$((n + 1))
  db="slate_test_$n"
  # A fresh database per suite: they all seed season 2026 and low team ids, so
  # sharing one would make the suites depend on each other's leftovers.
  "${PSQL[@]}" -q -c "create database $db;" >/dev/null
  DB=("${PSQL[@]}" -d "$db")
  # Errors here mean a broken schema, which would make every assertion below
  # meaningless — so they stop the run rather than getting swallowed.
  "${DB[@]}" -q -f "$REPO/supabase/tests/00_shim.sql" >/dev/null
  for f in "${MIGRATIONS[@]}"; do
    "${DB[@]}" -q -f "$f" >/dev/null 2>"$TMP/mig.err" || {
      echo "-- migration failed: $(basename "$f")" >&2; cat "$TMP/mig.err" >&2; exit 1;
    }
  done

  echo "-- $(basename "$t")"
  # -q drops BEGIN/COMMIT/CREATE FUNCTION chatter; \echo and results survive.
  "${DB[@]}" -q -f "$t" 2>&1 | sed "s|^psql:$t:[0-9]*: ||" | grep -v '^$' | tee -a "$out" || status=1
done

pass=$(grep -c '^PASS' "$out" || true)
fail=$(grep -c '^FAIL' "$out" || true)
echo
echo "-- $pass passed, $fail failed"
rm -f "$out"
[ "$fail" -eq 0 ] || status=1
[ "$pass" -gt 0 ] || { echo "-- no assertions ran" >&2; status=1; }
exit $status
