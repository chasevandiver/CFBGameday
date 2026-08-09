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
cleanup() {
  run "$PGBIN/pg_ctl -D $TMP/data -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

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
