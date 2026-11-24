# Deploying on Dokploy

The app runs on a Dokploy server as one **Docker Compose** application built from this repository:
`cmp/compose.prod.yaml`. Dokploy builds the images on the server, writes the variables you enter into the
`.env` file Compose reads, and routes your domain to the app through its Traefik, with a Let's Encrypt
certificate.

Nothing in the repository names a domain. The origin is the `PUBLIC_ORIGIN` variable, and the domain is
entered in Dokploy only.

## What runs

| Service | Image | Does |
| --- | --- | --- |
| `postgres` | `postgres:17.11-alpine` | The database. It is on an internal network only, with no published port. Data lives in the `postgres-data` volume. |
| `migrate` | the app image | Runs once per deploy, then exits. First `db:init`: it creates or updates the roles `cmp_owner`, `cmp_app` and `cmp_system` and the `cmp` database, as the superuser. Then the migrations, as `cmp_owner`. The app and worker start only after it succeeds. |
| `app` | the app image | The web app on port 4321, behind Traefik. |
| `worker` | the app image | Background jobs: email, and cleanup of expired sessions. |
| `backup` | `cmp/backup/` | A nightly `pg_dump`, encrypted with [age](https://age-encryption.org) to your public key. |

The app, the worker and `migrate` share one image: `cmp/Dockerfile`, built with the repository root as
context. `PUBLIC_ORIGIN` is a build argument as well as a variable. Prerendered pages contain absolute URLs
(canonical and hreflang links), so **the image is built for one origin**. Changing the domain therefore
means a redeploy, which rebuilds the image.

Every container:
- has a read-only root filesystem, with a tmpfs at `/tmp`;
- drops all capabilities and cannot gain privileges;
- has CPU, memory and process limits.

The app, worker and `migrate` run as the non-root user `node`. `backup` runs as `postgres`. Postgres's
own entrypoint starts as root to drop to its user, so it keeps the few capabilities it needs for that.

No service reads the `.env` file as a whole: there is no `env_file`. Each service receives only the
variables listed under its `environment`. **The app and the worker never receive** the owner, superuser or
backup credentials. Do not add `env_file: .env` to them: the owner role can turn row-level security off.
`test/unit/deploy.test.ts` fails if any of this changes.

## Before you start

1. **DNS.** Point an `A` record (and `AAAA`, if the server has IPv6) for your chosen hostname at the
   Dokploy server. Let's Encrypt needs it to resolve before the first deploy.
2. **SMTP.** You need an account with a mail provider in the EU (data stays in the EU). Set up SPF, DKIM
   and DMARC for the sender's domain, as the provider describes.
3. **A backup key pair, made on your own machine, not on the server:**

   ```sh
   age-keygen -o cmp-backup-key.txt
   # prints "Public key: age1..."; that public key is BACKUP_AGE_RECIPIENT
   ```

   Keep `cmp-backup-key.txt` (the private key) offline, in your password manager, and in a second place.
   Without it no backup can be read. The server only ever holds the public key.

## Create the application

In Dokploy:

1. **Create Service → Compose.** Set the compose type to Docker Compose (not Stack). Source: this
   repository, the branch you deploy. Compose path: `cmp/compose.prod.yaml`.
2. **Environment:** enter the variables below.
3. **Domains:** add your hostname.
   - Service: `app`
   - Container port: `4321`
   - Path: `/`
   - HTTPS on, certificate Let's Encrypt

   Dokploy then adds the Traefik labels to `app`, which is already on `dokploy-network`, and redirects
   HTTP to HTTPS.
4. **Deploy.** The first build takes a few minutes. `migrate` must end with `migrations applied`;
   `app` must become healthy.

### Environment

Generate each password and secret separately, for example with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Use URL-safe values: they
go inside URLs.

| Variable | Who gets it | Value |
| --- | --- | --- |
| `PUBLIC_ORIGIN` | build, app, worker | `https://<your hostname>`. No path, no trailing slash. |
| `BETTER_AUTH_SECRET` | app, worker | At least 32 random bytes. Changing it signs everyone out. |
| `SMTP_URL` | app, worker | `smtps://<user>:<password>@<smtp host>:465`, or `smtp://…:587` (STARTTLS). URL-encode the user and password. |
| `MAIL_FROM` | app, worker | `Name <address>` on the domain your SPF/DKIM cover. |
| `SUPER_ADMIN_EMAILS` | app, worker | Comma-separated addresses of the super-admins. They must verify their address and turn on two-factor authentication before the console opens. |
| `TRUSTED_PROXIES` | app, worker | The address range Traefik connects from (see below). |
| `POSTGRES_PASSWORD` | postgres | The superuser's password. |
| `DATABASE_URL` | app, worker, migrate | `postgres://cmp_app:<app password>@postgres:5432/cmp` |
| `DATABASE_URL_SYSTEM` | app, worker, migrate | `postgres://cmp_system:<system password>@postgres:5432/cmp` |
| `DATABASE_URL_MIGRATE` | migrate only | `postgres://cmp_owner:<owner password>@postgres:5432/cmp` |
| `DATABASE_URL_ADMIN` | migrate only | `postgres://postgres:<POSTGRES_PASSWORD>@postgres:5432/postgres` |
| `BACKUP_DATABASE_URL` | backup only | `postgres://postgres:<POSTGRES_PASSWORD>@postgres:5432/cmp` |
| `BACKUP_AGE_RECIPIENT` | backup only | The `age1…` public key from "Before you start". |
| `BACKUP_AT` | backup | When the nightly dump runs, `HH:MM` UTC (default `02:30`). |
| `BACKUP_KEEP_DAYS` | backup | How many days of dumps stay on the server (default 14). |
| `IMAGE_TAG` | Compose | Optional tag for the built images (default `latest`). |

`db:init` sets the three roles' passwords from the URLs on every deploy. To rotate a role's password,
change its URL and redeploy.

To use a Postgres outside this stack (for example a managed one in the EU), delete the `postgres`
service, point the URLs at that server, and remove `postgres` from the `depends_on` lists. The migrate
service still needs a role there that may create roles and databases.

### `TRUSTED_PROXIES` and client addresses

Sign-in rate limits count per client address (`src/server/client-address.ts`). The app takes that address
from the TCP connection. Only when the connection comes from a range in `TRUSTED_PROXIES` does it read
`X-Forwarded-For`, right to left, past those proxies. Traefik connects to the app over `dokploy-network`,
so `TRUSTED_PROXIES` must be that network's range:

```sh
docker network inspect dokploy-network --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}'
# for example 10.0.1.0/24
```

Leave Traefik's default handling of forwarded headers in place. With it, Traefik discards any
`X-Forwarded-For` a client sends and writes the client's real address, so a client cannot choose its own
address. Specifically, Dokploy's Traefik configuration (`/etc/dokploy/traefik/traefik.yml`) must not set
`forwardedHeaders.insecure: true` on its entry points. It must not list `forwardedHeaders.trustedIPs`
either, unless a CDN sits in front of the server; then list exactly the CDN's published ranges.

Consequences:
- **Without `TRUSTED_PROXIES`**, every request seems to come from Traefik, so all visitors share one rate limit.
- **With a range that is too wide** (for example `0.0.0.0/1`), a client can pick its own address and
  escape the limits.

## After the first deploy

Check each of these once:

1. `https://<hostname>/healthz` gives `ok` and `https://<hostname>/readyz` gives `ready`. Point an outside
   uptime monitor at both: `/healthz` says the process is up, `/readyz` says it reaches the database. The
   container's own health check is `/readyz`.
2. The response headers include `Strict-Transport-Security` and `Content-Security-Policy`. The certificate
   is Let's Encrypt's.
3. Sign up with a real address. The verification mail arrives, and its link is on your origin.
4. **Client addresses.** Sign in from a browser and open Account → Security: the session shows your own
   public address. Then send a forged header, `curl -H 'X-Forwarded-For: 203.0.113.9' https://<hostname>/healthz`.
   Requests like this must not change which address the app records. If Security shows Traefik's address,
   `TRUSTED_PROXIES` is wrong.
5. **No credentials in the runtime containers.** In Dokploy's terminal for `app`, `env | grep -E 'MIGRATE|DATABASE_URL_ADMIN|BACKUP'`
   must print nothing; check `worker` the same way.
6. **Super-admin.** A listed super-admin signs up, verifies the address, turns on two-factor
   authentication, then opens `/admin/accounts`.
7. **Backups.** In `backup`'s terminal, `backup.sh now` writes a first dump. Then run the restore test below.

## Updates

Redeploy in Dokploy. The image is rebuilt and `migrate` runs again: `db:init` is idempotent, and the
migrations apply only what is new, under an advisory lock. Then the app and the worker are replaced.

Migrations only move forward. Before a deploy that contains a migration, take a dump (`backup.sh now`). To
roll back across a migration, restore that dump (see Disaster recovery) and deploy the earlier commit.

Logs are JSON on stdout (Dokploy's Logs tab), with passwords, tokens, cookies and secrets redacted.

## Backups

The `backup` service writes `cmp-<UTC time>.dump.age` to the `backups` volume every night at `BACKUP_AT`:
`pg_dump --format=custom`, piped through `age --encrypt --recipient <BACKUP_AGE_RECIPIENT>`. Each file is
written under a temporary name and renamed only when complete. Dumps older than `BACKUP_KEEP_DAYS` are
deleted. It logs `backup written` (file name and size) or `backup failed`.

The dump runs as the superuser. The tenant tables force row-level security, so any other role would get a
filtered, incomplete dump.

**Copy the dumps off the server.** They are encrypted, so any storage will do: an S3 bucket in the EU, a
storage box, another machine. For example, run a nightly `rsync` or `rclone` of the `backups` volume's
directory (`docker volume inspect cloveconsent-cmp_backups` gives its path) after `BACKUP_AT`. A backup
that exists only on the server it protects does not survive losing that server.

### Restore test (monthly, and after any change to the backup)

A backup counts only once it has been restored. `restore-check.sh` restores one dump into a scratch
database on the same server, prints the number of migrations and the rows per table (with each table's
row-level security), then drops the scratch database.

1. Copy the private key into the `backup` container's tmpfs, without writing it to disk. From your
   machine, through Dokploy's server terminal:

   ```sh
   docker exec -i "$(docker ps -qf name=cloveconsent-cmp-backup)" sh -c 'umask 077; cat > /tmp/key.txt' < cmp-backup-key.txt
   ```

2. Restore the newest dump:

   ```sh
   docker exec -e PGHOST=postgres -e PGUSER=postgres -e PGPASSWORD='<POSTGRES_PASSWORD>' \
     "$(docker ps -qf name=cloveconsent-cmp-backup)" \
     sh -c 'restore-check.sh "/backups/$(ls /backups | grep dump.age | tail -1)" /tmp/key.txt'
   ```

3. Compare the counts with the live database, for example `select count(*) from auth_user`. The live
   one may have grown since the dump. `audit_log` and `entitlements` must say `rls forced`.
4. Remove the key: restart the `backup` container (its tmpfs is emptied), or
   `docker exec <container> sh -c ': > /tmp/key.txt'`.

Record the date and the counts. This procedure was rehearsed with the stack of `compose.prod.yaml` before
the first release. A dump of the development database (227 users) restored with identical counts. A
full disaster recovery (steps below) brought the app back to `ready`.

### Disaster recovery (a new server, or a lost database)

1. Deploy the application as above, with the same variables. Wait until `migrate` has run, then stop
   `app` and `worker` in Dokploy.
2. Replace the empty database with the dump. Copy the dump into the `backups` volume and the key into the
   `backup` container's `/tmp`, as in the restore test. Then, in the `backup` container:

   ```sh
   export PGHOST=postgres PGUSER=postgres PGPASSWORD='<POSTGRES_PASSWORD>'
   psql -d postgres -c 'drop database cmp with (force)'
   ```

3. Recreate the empty database and the roles, with the deploy's own step. From the server, in the
   project's directory:

   ```sh
   docker compose -p <project> run --rm --no-deps migrate sh -c 'node scripts/db-init.ts'
   ```

4. Back in the `backup` container, restore into the new database:

   ```sh
   set -o pipefail
   age -d -i /tmp/key.txt /backups/<file>.dump.age | pg_restore --exit-on-error --single-transaction --dbname=cmp
   ```

5. Redeploy. `migrate` applies any migration newer than the dump, and the app and the worker start.
   `/readyz` must answer `ready`.

## Security notes

- Postgres is reachable only from the services on the internal `db` network. Only `app` is on
  `dokploy-network`. The worker and the app reach the internet (SMTP, Have I Been Pwned's range API)
  over `egress`.
- Sessions use `__Secure-` cookies, because `PUBLIC_ORIGIN` is https. Production refuses an http origin.
- Rotating `BETTER_AUTH_SECRET` signs everyone out. It also makes the stored TOTP secrets and backup
  codes unreadable, because they are encrypted with it, so everyone's two-factor authentication would
  have to be set up again. Rotate it only after a compromise, and plan for that.
- This is not legal advice. Your privacy notice and your data processing agreements with the mail and
  hosting providers are yours to write.
