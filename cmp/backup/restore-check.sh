#!/bin/sh
# Restores one encrypted backup into a scratch database and prints what it holds, then drops it
# (docs/deploy-dokploy.md, "Restore test"). Run it monthly, and after any change to the backup, OFF the
# production server: on your own machine, against a throwaway Postgres, so the private key never reaches
# the server.
#
#   restore-check.sh <cmp-....dump.age> -  < cmp-backup-key.txt     (the age identity on stdin)
#   restore-check.sh <cmp-....dump.age> <identity file>
#
# Connection: libpq's own variables (PGHOST, PGUSER, …) for a role that may create databases and roles;
# a throwaway server needs no password. The app's roles own and are granted the restored objects: any that
# is missing on that server is created (NOLOGIN). The scratch database is RESTORE_DATABASE (default
# cmp_restore_check); KEEP=1 keeps it for a closer look.
set -eu

file="${1:?usage: restore-check.sh <dump.age> <identity file, or - for stdin>}"
identity="${2:?usage: restore-check.sh <dump.age> <identity file, or - for stdin>}"
db="${RESTORE_DATABASE:-cmp_restore_check}"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"

if [ "$identity" = "-" ]; then
  umask 077
  identity="$(mktemp)"
  trap 'rm -f "$identity"' EXIT
  cat > "$identity"
fi

# a server just started may take a moment
tries=0
until pg_isready -q -d postgres; do
  tries=$((tries + 1))
  [ "$tries" -ge 60 ] && { echo 'restore-check: the server does not answer' >&2; exit 1; }
  sleep 1
done

psql --no-password -d postgres -v ON_ERROR_STOP=1 -q <<SQL
do \$\$ declare role text; begin
  foreach role in array array['cmp_owner', 'cmp_app', 'cmp_system', 'cmp_backup'] loop
    if not exists (select 1 from pg_roles where rolname = role) then execute format('create role %I nologin', role); end if;
  end loop;
end \$\$;
drop database if exists "$db" with (force);
create database "$db";
SQL

dumped="$(mktemp)"
if ! { age --decrypt --identity "$identity" "$file"; echo "$?" > "$dumped"; } | pg_restore --no-password --exit-on-error --single-transaction --dbname="$db" ||
  [ "$(cat "$dumped")" != 0 ]; then
  rm -f "$dumped"
  echo "restore-check: $(basename "$file") did not restore" >&2
  exit 1
fi
rm -f "$dumped"

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
