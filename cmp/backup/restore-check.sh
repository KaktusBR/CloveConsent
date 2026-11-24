#!/bin/sh
# Restores one encrypted backup into a scratch database on the same server and prints what it holds, then
# drops it (docs/deploy-dokploy.md, "Restore test"). Run it monthly, and after any change to the backup:
#
#   restore-check.sh <cmp-....dump.age> <age identity file>
#
# Connection: libpq's own variables, PGHOST, PGPORT, PGUSER, PGPASSWORD, for a role that may create
# databases and owns nothing it should not (the server's superuser). The scratch database is
# RESTORE_DATABASE (default cmp_restore_check); KEEP=1 keeps it for a closer look.
# The app's roles (cmp_owner, cmp_app, cmp_system) must exist on that server (`db:init`), as they own and
# are granted the restored objects.
set -eu
set -o pipefail

file="${1:?usage: restore-check.sh <dump.age> <identity file>}"
identity="${2:?usage: restore-check.sh <dump.age> <identity file>}"
db="${RESTORE_DATABASE:-cmp_restore_check}"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

psql --no-password -d postgres -v ON_ERROR_STOP=1 -q -c "drop database if exists \"$db\" with (force)" -c "create database \"$db\""
age --decrypt --identity "$identity" "$file" | pg_restore --no-password --exit-on-error --single-transaction --dbname="$db"

echo "restored $(basename "$file") into $db:"
psql --no-password -d "$db" -v ON_ERROR_STOP=1 -At -F ' ' <<'SQL'
select 'migrations', count(*) from drizzle.__drizzle_migrations;
select 'table ' || c.relname || ' (rls ' || case when c.relforcerowsecurity then 'forced' when c.relrowsecurity then 'on' else 'off' end || ')',
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' order by c.relname;
select 'queued jobs', count(*) from pgboss.job;
SQL

if [ "${KEEP:-}" != "1" ]; then
  psql --no-password -d postgres -v ON_ERROR_STOP=1 -q -c "drop database \"$db\" with (force)"
  echo "dropped $db"
fi
