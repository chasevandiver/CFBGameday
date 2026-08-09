#!/usr/bin/env bash
# Apply every migration to a throwaway Postgres and run the SQL test scripts
# against it.
#
# The invariants in 0013 and 0020 are enforced by RLS policies, column grants
# and security-definer functions. None of that is reachable from vitest, and
# none of it should be verified by reading the SQL and nodding — a revoked
# grant either stops a direct PostgREST call or it doesn't. So: a real cluster,
# a shim for the three Supabase API roles and auth.uid(), and assertions that
# impersonate a member, a non-member and a signed-out visitor.
#
#   scripts/db-test.sh                    # every supabase/tests/*.sql
#   scripts/db-test.sh supabase/tests/groups.sql
#
# Set TEST_DATABASE_URL to run against an existing server instead of spinning
# one up (the shim expects to own the roles, so point it at a scratch database).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
TESTS=("$@")
if [ ${#TESTS[@]} -eq 0 ]; then
  TESTS=("$REPO"/supabase/tests/*.sql)
fi
# The shim is applied first, never as a test of its own.
FILTERED=()
for t in "${TESTS[@]}"; do
  case "$(basename "$t")" in 00_shim.sql) ;; *) FILTERED+=("$t") ;; esac
done

if [ -n "${TEST_DATABASE_URL:-}" ]; then
  PSQL=(psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 --no-psqlrc)
  CREATE_DB=false
else
  PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  [ -n "$PGBIN" ] || { echo "No local Postgres found and TEST_DATABASE_URL is unset." >&2; exit 1; }
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
  cleanup() { run "$PGBIN/pg_ctl -D $TMP/data -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
  trap cleanup EXIT

  run "$PGBIN/initdb -U postgres -A trust -D $TMP/data" >/dev/null
  run "$PGBIN/pg_ctl -D $TMP/data -o '-k $TMP/sock -c listen_addresses=\"\"' -l $TMP/pg.log -w start" >/dev/null
  PSQL=(psql -h "$TMP/sock" -U postgres -v ON_ERROR_STOP=1 --no-psqlrc)
  CREATE_DB=true
fi

if [ "$CREATE_DB" = true ]; then
  "${PSQL[@]}" -q -c "drop database if exists slate_test;" -c "create database slate_test;" >/dev/null
  PSQL+=(-d slate_test)
fi

"${PSQL[@]}" -q -f "$REPO/supabase/tests/00_shim.sql" >/dev/null
for f in "$REPO"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -q -f "$f" >/dev/null
done
echo "-- applied $(ls "$REPO"/supabase/migrations/*.sql | wc -l | tr -d ' ') migrations"

out="$(mktemp)"
status=0
for t in "${FILTERED[@]}"; do
  echo "-- $(basename "$t")"
  # -q drops BEGIN/COMMIT/CREATE FUNCTION chatter; \echo and results survive.
  "${PSQL[@]}" -q -f "$t" 2>&1 | sed "s|^psql:$t:[0-9]*: ||" | grep -v '^$' | tee -a "$out" || status=1
done

pass=$(grep -c '^PASS' "$out" || true)
fail=$(grep -c '^FAIL' "$out" || true)
echo
echo "-- $pass passed, $fail failed"
rm -f "$out"
[ "$fail" -eq 0 ] || status=1
[ "$pass" -gt 0 ] || { echo "-- no assertions ran" >&2; status=1; }
exit $status
