#!/usr/bin/env bash
# Restore check for the live-database backup (phase-01 plan §7.8, 1B·H11, T24).
#
# Decrypts one `live-<date>.dump.age` artifact, restores it into an empty PostgreSQL
# database (a throwaway service container on the CI runner, never a Neon project), and
# compares exact row counts per table with the counts taken right before the dump.
#
# Usage:
#   scripts/db/restore-check.sh <live-DATE.dump.age> <counts-DATE.json.age>
#
# Environment:
#   BACKUP_AGE_IDENTITY   contents of the age identity file (AGE-SECRET-KEY-1…). Required.
#   RESTORE_DATABASE_URL  empty target database, e.g. postgresql://postgres:restore@localhost:5432/postgres
#   RESTORE_TOLERANCE     allowed relative drift per table (default 0.01 = 1 %); a table may
#                         always differ by 1 row, because the counts and the dump are taken
#                         a moment apart.
#
# Exit codes: 0 pass, 1 counts differ or a table is missing, 2 usage or tooling error.
#
# Nothing secret is printed: the identity lives in a 0600 temp file that is removed on exit,
# and the decrypted dump never leaves the runner's temp directory.

set -euo pipefail

usage() {
  sed -n '2,15p' "$0" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
DUMP_AGE=$1
COUNTS_AGE=$2
: "${BACKUP_AGE_IDENTITY:?BACKUP_AGE_IDENTITY is not set}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is not set}"
TOLERANCE=${RESTORE_TOLERANCE:-0.01}

for tool in age pg_restore psql jq; do
  command -v "$tool" >/dev/null 2>&1 || { echo "restore-check: $tool is not installed" >&2; exit 2; }
done
[[ -f $DUMP_AGE ]] || { echo "restore-check: $DUMP_AGE not found" >&2; exit 2; }
[[ -f $COUNTS_AGE ]] || { echo "restore-check: $COUNTS_AGE not found" >&2; exit 2; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
umask 077

printf '%s\n' "$BACKUP_AGE_IDENTITY" > "$WORK/identity"
age --decrypt -i "$WORK/identity" -o "$WORK/live.dump" "$DUMP_AGE"
age --decrypt -i "$WORK/identity" -o "$WORK/counts.json" "$COUNTS_AGE"
rm -f "$WORK/identity"

echo "restore-check: restoring $(basename "$DUMP_AGE") ($(du -h "$WORK/live.dump" | cut -f1))"
# No --exit-on-error: objects the target cannot have (Neon roles, extensions) are reported
# and skipped. The row-count comparison below is the pass/fail signal.
set +e
pg_restore --no-owner --no-privileges --dbname="$RESTORE_DATABASE_URL" "$WORK/live.dump" 2> "$WORK/restore.log"
RESTORE_STATUS=$?
set -e
if [[ $RESTORE_STATUS -ne 0 ]]; then
  echo "restore-check: pg_restore exited $RESTORE_STATUS; its warnings follow" >&2
  grep -E '^pg_restore: (error|warning)' "$WORK/restore.log" | head -n 40 >&2 || true
fi

# Exact counts in the restored database, in the same JSON shape the dump job writes:
# { "<table>": <rows>, … } for every base table in schema public.
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -At > "$WORK/restored.json" <<'SQL'
SELECT COALESCE(json_object_agg(table_name, rows ORDER BY table_name), '{}'::json)
FROM (
  SELECT t.table_name,
         (xpath('/row/c/text()',
                query_to_xml(format('SELECT count(*) AS c FROM %I.%I', t.table_schema, t.table_name),
                             false, true, '')))[1]::text::bigint AS rows
  FROM information_schema.tables t
  WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
) counts;
SQL

REPORT=$(jq -n --slurpfile expected "$WORK/counts.json" --slurpfile actual "$WORK/restored.json" \
  --argjson tol "$TOLERANCE" '
  ($expected[0]) as $e | ($actual[0]) as $a
  | [ $e | to_entries[]
      | .key as $t | .value as $want | ($a[$t]) as $got
      | { table: $t, expected: $want, restored: $got,
          ok: ($got != null and ((($got - $want) | fabs) <= ([1, ($want * $tol)] | max))) } ]')

echo "$REPORT" | jq -r '.[] | "\(if .ok then "ok  " else "FAIL" end) \(.table): expected \(.expected), restored \(.restored // "missing")"'

TABLES=$(echo "$REPORT" | jq 'length')
FAILED=$(echo "$REPORT" | jq '[.[] | select(.ok | not)] | length')
if [[ $TABLES -eq 0 ]]; then
  echo "restore-check: the counts file lists no tables" >&2
  exit 1
fi
if [[ $FAILED -ne 0 ]]; then
  echo "restore-check: $FAILED of $TABLES tables differ by more than $TOLERANCE" >&2
  exit 1
fi
echo "restore-check: all $TABLES tables within $TOLERANCE"
