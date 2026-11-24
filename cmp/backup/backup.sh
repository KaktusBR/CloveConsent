#!/bin/sh
# Nightly encrypted dump of the app's database (backup/Dockerfile). Every day at BACKUP_AT (HH:MM, UTC):
#   pg_dump --format=custom "$BACKUP_DATABASE_URL" | age -r "$BACKUP_AGE_RECIPIENT" > /backups/cmp-<UTC time>.dump.age
# then deletes dumps older than BACKUP_KEEP_DAYS. `backup.sh now` makes one dump and exits.
#
# BACKUP_DATABASE_URL must connect as a role that bypasses row-level security (the server's superuser):
# the tenant tables FORCE it, so any other role would dump them filtered. Errors never print a value.
set -eu
set -o pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is not set}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is not set (an age public key, age1...)}"
BACKUP_AT="${BACKUP_AT:-02:30}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
DIR=/backups

dump() {
  name="cmp-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
  # written under a temporary name, renamed only once complete: a half-written file is never a backup
  pg_dump --format=custom --no-password --dbname="$BACKUP_DATABASE_URL" | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" > "$DIR/.$name.partial"
  mv "$DIR/.$name.partial" "$DIR/$name"
  find "$DIR" -maxdepth 1 -name 'cmp-*.dump.age' -mtime "+$BACKUP_KEEP_DAYS" -delete
  echo "{\"level\":\"info\",\"msg\":\"backup written\",\"file\":\"$name\",\"bytes\":$(wc -c < "$DIR/$name")}"
}

if [ "${1:-}" = "now" ]; then
  dump
  exit 0
fi

case "$BACKUP_AT" in
  [01][0-9]:[0-5][0-9] | 2[0-3]:[0-5][0-9]) ;;
  *) echo '{"level":"error","msg":"BACKUP_AT must be HH:MM (UTC)"}' >&2; exit 1 ;;
esac
hour=$(echo "$BACKUP_AT" | cut -d: -f1 | sed 's/^0//')
minute=$(echo "$BACKUP_AT" | cut -d: -f2 | sed 's/^0//')
at=$(( ${hour:-0} * 3600 + ${minute:-0} * 60 ))
echo "{\"level\":\"info\",\"msg\":\"backup scheduled\",\"at\":\"$BACKUP_AT UTC\",\"keepDays\":$BACKUP_KEEP_DAYS}"
while true; do
  now=$(date -u +%s)
  next=$(( now - now % 86400 + at ))
  [ "$next" -le "$now" ] && next=$(( next + 86400 ))
  sleep $(( next - now ))
  # a failed night is logged and retried the next night; the container keeps running
  dump || echo '{"level":"error","msg":"backup failed"}'
done
