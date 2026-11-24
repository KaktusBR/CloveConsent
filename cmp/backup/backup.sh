#!/bin/sh
# Nightly encrypted dump of the app's database (backup/Dockerfile). Every day at BACKUP_AT (HH:MM, UTC):
#   pg_dump --format=custom "$BACKUP_DATABASE_URL" | age -r "$BACKUP_AGE_RECIPIENT" > /backups/cmp-<UTC time>.dump.age
# then deletes dumps older than BACKUP_KEEP_DAYS. `backup.sh now` makes one dump and exits.
#
# A dump is kept only when pg_dump and age both succeeded and wrote something: it is written under a
# temporary name and renamed once whole; anything else is deleted and the run is reported as failed (and
# `backup.sh now` exits 1). Old dumps are deleted only after a new one was kept, so failing nights never
# empty the volume.
#
# BACKUP_DATABASE_URL connects as cmp_backup (scripts/db-init.ts): read-only, and it bypasses row-level
# security, as pg_dump needs (the tenant tables FORCE it). Errors never print a value.
set -eu

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is not set}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is not set (an age public key, age1...)}"
BACKUP_AT="${BACKUP_AT:-02:30}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
DIR="${BACKUP_DIR:-/backups}"

dump() {
  name="cmp-$(date -u +%Y%m%dT%H%M%SZ).dump.age"
  partial="$DIR/.$name.partial"
  dumped="$(mktemp)"
  # each stage checked on its own: pg_dump's status is kept aside, the pipeline's is age's
  if { pg_dump --format=custom --no-password --dbname="$BACKUP_DATABASE_URL"; echo "$?" > "$dumped"; } | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" > "$partial" &&
    [ "$(cat "$dumped")" = 0 ] && [ -s "$partial" ] && mv "$partial" "$DIR/$name"; then
    rm -f "$dumped"
    find "$DIR" -maxdepth 1 -name 'cmp-*.dump.age' -mtime "+$BACKUP_KEEP_DAYS" -delete ||
      echo '{"level":"warn","msg":"old backups not deleted"}' >&2
    echo "{\"level\":\"info\",\"msg\":\"backup written\",\"file\":\"$name\",\"bytes\":$(wc -c < "$DIR/$name")}"
    return 0
  fi
  rm -f "$partial" "$dumped"
  echo '{"level":"error","msg":"backup failed"}' >&2
  return 1
}

if [ "${1:-}" = "now" ]; then
  if dump; then exit 0; else exit 1; fi
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
  # a failed night is logged (by dump) and tried again the next night; the container keeps running
  dump || true
done
