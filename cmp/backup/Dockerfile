# syntax=docker/dockerfile:1
# The nightly database backup (compose.prod.yaml, service `backup`; docs/deploy-dokploy.md, Backups):
# pg_dump of the app's database, encrypted with age to a public key, kept on a volume for BACKUP_KEEP_DAYS.
# The server holds only the public key: a stolen backup volume cannot be read without the private key,
# which is kept off the server. Build context: this folder.
FROM postgres:17.11-alpine
RUN apk add --no-cache age
COPY --chmod=0555 backup.sh restore-check.sh /usr/local/bin/
RUN install -d -o postgres -g postgres -m 0700 /backups
USER postgres
WORKDIR /backups
ENTRYPOINT ["/usr/local/bin/backup.sh"]
