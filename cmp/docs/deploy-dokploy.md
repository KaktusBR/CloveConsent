# Deploying on Dokploy

The app runs on a Dokploy server as one **Docker Compose** application built from this repository:
`cmp/compose.prod.yaml`. Dokploy builds the images on the server, writes the variables you enter into the
`.env` file Compose reads, and routes your domain to the app through its Traefik, with a Let's Encrypt
certificate.

Nothing in the repository names a domain. The origin is the `PUBLIC_ORIGIN` variable, and the domain is
entered in Dokploy only.

In this guide, **`<project>`** is the Dokploy application's name. Dokploy runs Compose with
`-p <project>`, so:
- containers are named `<project>-<service>-1` (for example `<project>-postgres-1`);
- volumes are named `<project>_<volume>` (for example `<project>_backups`).

Set `IMAGE_NAME` to the same name, so the images are `<project>:<tag>` and `<project>-backup:<tag>`. Two
applications on one server then share no container, volume or image.

## What runs

| Service | Image | Does |
| --- | --- | --- |
| `postgres` | `postgres:18.7-alpine` | The database. It is on an internal network only, with no published port. Data lives in the `postgres-data` volume. |
| `migrate` | `<IMAGE_NAME>` | Runs once per deploy, then exits. First `db:init`, as the superuser: it creates or updates the roles and the `cmp` database. Then the migrations, as `cmp_owner`. The app, the worker and the backup start only after it succeeds. |
| `app` | `<IMAGE_NAME>` | The web app on port 4321, behind Traefik. |
| `worker` | `<IMAGE_NAME>` | Background jobs: email, and cleanup of expired sessions. |
| `backup` | `<IMAGE_NAME>-backup` (`cmp/backup/`) | A nightly `pg_dump` as `cmp_backup`, encrypted with [age](https://age-encryption.org) to your public key. |

The roles that `db:init` creates or updates (`scripts/db-init.ts`):

| Role | Used by | Can do |
| --- | --- | --- |
| `cmp_owner` | `migrate` | Owns the tables; runs the migrations. |
| `cmp_app` | `app`, `worker` | Runtime work, under row-level security. |
| `cmp_system` | `app`, `worker` | Audited system work. |
| `cmp_backup` | `backup` | Reads only: `SELECT` on every table and sequence, and read-only sessions. It bypasses row-level security, because the tenant tables force it and `pg_dump` must see every row. It is not a superuser. |

The app, the worker and `migrate` share one image: `cmp/Dockerfile`, built with the repository root as
context. `PUBLIC_ORIGIN` is a build argument as well as a variable. Prerendered pages contain absolute URLs
(canonical and hreflang links), so **the image is built for one origin**. Changing the domain therefore
means a redeploy, which rebuilds the image.

Every container:
- has a read-only root filesystem, with a tmpfs at `/tmp`;
- drops all capabilities and cannot gain privileges;
- has CPU, memory and process limits.

The app, the worker and `migrate` run as the non-root user `node`. `backup` runs as `postgres`. Postgres's
own entrypoint starts as root to drop to its user, so it keeps the few capabilities it needs for that.

No service reads the `.env` file as a whole: there is no `env_file`. Each service receives only the
variables listed under its `environment`. **The app and the worker never receive** the owner, superuser or
backup credentials. The superuser's password reaches only `postgres` and the one-shot `migrate`. Do not add
`env_file: .env` to a service: the owner role can turn row-level security off.
`test/unit/deploy.test.ts` fails if any of this changes.

## Before you start

1. **DNS.** Point an `A` record (and `AAAA`, if the server has IPv6) for your chosen hostname at the
   Dokploy server. Let's Encrypt needs it to resolve before the first deploy.
2. **SMTP.** You need an account with a mail provider in the EU (data stays in the EU). Set up SPF, DKIM
   and DMARC for the sender's domain, as the provider describes.
3. **A backup key pair, made on your own machine, never on the server:**

   ```sh
   age-keygen -o cmp-backup-key.txt
   # prints "Public key: age1..."; that public key is BACKUP_AGE_RECIPIENT
   ```

   Keep `cmp-backup-key.txt` (the private key) offline, in your password manager, and in a second place.
   Without it no backup can be read. The server only ever holds the public key, and the restore test and
   disaster recovery below never copy the private key to the server.

## Create the application

In Dokploy:

1. **Create Service → Compose.** Set the compose type to Docker Compose (not Stack). Source: this
   repository, the branch you deploy. Compose path: `cmp/compose.prod.yaml`. The application's name is
   `<project>`.
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
| `IMAGE_NAME` | Compose | `<project>`, the Dokploy application's name. The images are named after it. |
| `IMAGE_TAG` | Compose | Optional (default `latest`). |
| `PUBLIC_ORIGIN` | build, app, worker | `https://<your hostname>`. No path, no trailing slash. |
| `BETTER_AUTH_SECRET` | app, worker | At least 32 random bytes. Changing it signs everyone out (see Security notes). |
| `SMTP_URL` | app, worker | `smtps://<user>:<password>@<smtp host>:465`, or `smtp://…:587` (STARTTLS). URL-encode the user and password. Mail goes over TLS only: STARTTLS is required on `smtp://`, TLS 1.2 at least, the certificate checked; the app refuses to start with `?options` or a `#fragment` in this URL. |
| `MAIL_FROM` | app, worker | `Name <address>` on the domain your SPF/DKIM cover. |
| `SUPER_ADMIN_EMAILS` | app, worker | Comma-separated addresses of the super-admins. They must verify their address and turn on two-factor authentication before the console opens. |
| `TRUSTED_PROXIES` | app, worker | The address range Traefik connects from (see below). |
| `POSTGRES_PASSWORD` | postgres | The superuser's password. |
| `DATABASE_URL` | app, worker, migrate | `postgres://cmp_app:<app password>@postgres:5432/cmp` |
| `DATABASE_URL_SYSTEM` | app, worker, migrate | `postgres://cmp_system:<system password>@postgres:5432/cmp` |
| `DATABASE_URL_MIGRATE` | migrate only | `postgres://cmp_owner:<owner password>@postgres:5432/cmp` |
| `DATABASE_URL_ADMIN` | migrate only | `postgres://postgres:<POSTGRES_PASSWORD>@postgres:5432/postgres` |
| `DATABASE_URL_BACKUP` | migrate, backup | `postgres://cmp_backup:<backup password>@postgres:5432/cmp` |
| `BACKUP_AGE_RECIPIENT` | backup | The `age1…` public key from "Before you start". |
| `BACKUP_AT` | backup | When the nightly dump runs, `HH:MM` UTC (default `02:30`). |
| `BACKUP_KEEP_DAYS` | backup | How many days of dumps stay on the server (default 14). |

`db:init` sets the roles' passwords from the URLs on every deploy. To rotate a role's password, change its
URL and redeploy.

To use a Postgres outside this stack (for example a managed one in the EU):
1. Delete the `postgres` service.
2. Point the URLs at that server.
3. Remove `postgres` from the `depends_on` lists.

`migrate` still needs a role on that server that may create roles and databases, and grant `BYPASSRLS`.

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

Check 4 below proves which address the app records.

**What this trusts.** The app believes `X-Forwarded-For` from any address in `TRUSTED_PROXIES`. With the
whole `dokploy-network` range there, that is every container on that network, not only Traefik: any other
application Dokploy runs on the same server is on it too, and a compromised one could connect to the app
directly and name any client address, escaping the sign-in rate limits. To trust Traefik alone, give its
own address instead of the range:

```sh
docker inspect dokploy-traefik --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}'
# for example 10.0.1.2: set TRUSTED_PROXIES=10.0.1.2
```

That address can change when Traefik's container is re-created (a Dokploy update): check it after each
one (check 4 below shows a wrong value at once: every visitor gets Traefik's address). If you cannot keep
that up, the range is the accepted fallback, with the residual above.

### Request size

The app refuses a request body over 64 KiB with `413` before reading it (`src/server/request-body.ts`), so
one large upload cannot exhaust the container's memory. Nothing it serves needs more. Optionally, Traefik
can refuse such requests before they reach the app, with a buffering middleware on the app's router, for
example as labels:

```yaml
traefik.http.middlewares.cmp-body-limit.buffering.maxRequestBodyBytes: "65536"
traefik.http.routers.<the app's router>.middlewares: cmp-body-limit
```

## After the first deploy

Check each of these once:

1. `https://<hostname>/healthz` gives `ok` and `https://<hostname>/readyz` gives `ready`. Point an outside
   uptime monitor at both: `/healthz` says the process is up, `/readyz` says it reaches the database. The
   container's own health check is `/readyz`.
2. The response headers include `Strict-Transport-Security` and `Content-Security-Policy`. The certificate
   is Let's Encrypt's.
3. Sign up with a real address. The verification mail arrives, and its link is on your origin.
4. **Client addresses: a forged `X-Forwarded-For` must not be believed.** From your own machine, sign in
   through a request that carries a forged header, then list that session:

   ```sh
   curl -s -c jar.txt -H 'Origin: https://<hostname>' -H 'X-Forwarded-For: 203.0.113.9' \
     -H 'Content-Type: application/json' -d '{"email":"<you>","password":"<password>"}' \
     https://<hostname>/api/auth/sign-in/email > /dev/null
   curl -s -b jar.txt https://<hostname>/api/auth/list-sessions
   ```

   The session's `ipAddress` must be your own public address. It must not be `203.0.113.9`, nor
   Traefik's address. Account → Security shows the same address for that session. Sign it out there
   afterwards.
   - It shows `203.0.113.9`: Traefik trusts client headers. Fix its `forwardedHeaders`.
   - It shows an address in `dokploy-network`: `TRUSTED_PROXIES` is wrong.
5. **No credentials in the runtime containers.** On the server, run
   `docker exec <project>-app-1 env | grep -E 'MIGRATE|DATABASE_URL_ADMIN|BACKUP|POSTGRES_PASSWORD'`. It
   must print nothing. Check `<project>-worker-1` the same way.
6. **Super-admin.** A listed super-admin signs up, verifies the address, turns on two-factor
   authentication, then opens `/admin/accounts`.
7. **Backups.** `docker exec <project>-backup-1 backup.sh now` writes a first dump (it logs
   `backup written`). Then run the restore test below.

## Updates

Redeploy in Dokploy. The images are rebuilt and `migrate` runs again: `db:init` is idempotent, and the
migrations apply only what is new, under an advisory lock. Then the app and the worker are replaced.

Migrations only move forward. Before a deploy that contains a migration, take a dump:
`docker exec <project>-backup-1 backup.sh now`. To roll back across a migration, restore that dump (see
Disaster recovery) and deploy the earlier commit.

Logs are JSON on stdout (Dokploy's Logs tab), with passwords, tokens, cookies and secrets redacted.

## Backups

The `backup` service writes `cmp-<UTC time>.dump.age` to the `<project>_backups` volume every night at
`BACKUP_AT`:

1. `pg_dump --format=custom`, as `cmp_backup`, is piped through `age --encrypt --recipient <BACKUP_AGE_RECIPIENT>`.
2. The file is written under a temporary name.
3. It is renamed only when both `pg_dump` and `age` succeeded.
4. Only after that are dumps older than `BACKUP_KEEP_DAYS` deleted.

A failed night therefore keeps no partial file, deletes no older dump, and logs `backup failed`
(`backup.sh now` exits 1). A successful night logs `backup written`, with the file name and size. Watch
for `backup failed` in the logs.

**Copy the dumps off the server.** They are encrypted, so any storage will do: an S3 bucket in the EU, a
storage box, another machine. For example, run a nightly `rsync` or `rclone` of the volume's directory
(`docker volume inspect <project>_backups --format '{{.Mountpoint}}'`) after `BACKUP_AT`. A backup that
exists only on the server it protects does not survive losing that server.

### Restore test (monthly, and after any change to the backup)

A backup counts only once it has been restored. The test runs **on your own machine**, against a throwaway
Postgres, with the private key passed on stdin: neither the key nor any password goes to the server or onto
a command line. You need Docker and a checkout of this repository.

```sh
# 1. a recent dump, copied from the server (encrypted: safe to move anywhere)
ssh <server> "docker cp <project>-backup-1:/backups/<file>.dump.age /tmp/" && scp <server>:/tmp/<file>.dump.age .

# 2. the backup image, and a throwaway Postgres on its own network (no published port, no password)
docker build -t cmp-backup <checkout>/cmp/backup
docker network create cmp-restore-test
docker run -d --name cmp-restore-db --network cmp-restore-test -e POSTGRES_HOST_AUTH_METHOD=trust postgres:18.7-alpine

# 3. restore and count, the key on stdin
docker run --rm -i --network cmp-restore-test -e PGHOST=cmp-restore-db -e PGUSER=postgres -v "$PWD:/work:ro" \
  --entrypoint restore-check.sh cmp-backup /work/<file>.dump.age - < cmp-backup-key.txt

# 4. clean up
docker rm -f cmp-restore-db && docker network rm cmp-restore-test
```

`restore-check.sh` (in `cmp/backup/`):
- waits for the server;
- creates the app's roles there if they are missing (as NOLOGIN), since they own and are granted the
  restored objects;
- restores into a scratch database;
- prints the number of migrations, the rows per table with each table's row-level security, and the
  queued jobs;
- then drops the scratch database.

A wrong key or a damaged file ends with `did not restore` and exit 1.

Compare the counts with the live database:

```sh
ssh <server> "docker exec <project>-postgres-1 psql -U postgres -d cmp -Atc 'select count(*) from auth_user'"
```

The live database may have grown since the dump. `audit_log` and `entitlements` must say `rls forced`.
Record the date and the counts.

This procedure was rehearsed with the stack of `compose.prod.yaml`:
- a dump taken by `cmp_backup` of a copy of the development database (227 users, 341 audit rows,
  34 entitlements) restored off-server with identical counts;
- a wrong key failed as described.

### Disaster recovery (a new server, or a lost database)

The plaintext dump goes from your machine straight into the server's Postgres over SSH. The key stays on
your machine, and no password is typed. You need `age` locally, or the backup image from the restore test.

1. Deploy the application as above, with the same variables. Wait until `migrate` has run, then stop
   `app`, `worker` and `backup` in Dokploy.
2. Replace the database with an empty one, owned by the owner role. This runs over Postgres's local
   socket inside its container, which needs no password:

   ```sh
   ssh <server> "docker exec <project>-postgres-1 psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
     -c 'drop database cmp with (force)' -c 'create database cmp owner cmp_owner'"
   ```

3. Decrypt on your machine and restore on the server:

   ```sh
   age --decrypt --identity cmp-backup-key.txt <file>.dump.age | \
     ssh <server> "docker exec -i <project>-postgres-1 pg_restore -U postgres --exit-on-error --single-transaction --dbname=cmp"
   ```

4. Redeploy in Dokploy. `db:init` re-applies the database's grants, including the backup role's read
   access to the restored tables. `migrate` applies any migration newer than the dump. The app, the worker
   and the backup start, and `/readyz` must answer `ready`. Then take a fresh dump
   (`backup.sh now`): it proves the backup role reads the restored database.

This was rehearsed end to end with the stack of `compose.prod.yaml`, with the decryption done by the backup
image on the "operator" side and the stream fed into `docker exec -i <project>-postgres-1 pg_restore`. The
app came back `ready` with all 227 users, and the next `backup.sh now` succeeded as `cmp_backup`.

## Security notes

- Postgres is reachable only from the services on the internal `db` network. Only `app` is on
  `dokploy-network`. The worker and the app reach the internet (SMTP, Have I Been Pwned's range API)
  over `egress`.
- The backup connects as `cmp_backup`: it can read everything, which is the point of a backup, and write
  nothing. The dumps are encrypted to a key the server does not have.
- Sessions use `__Secure-` cookies, because `PUBLIC_ORIGIN` is https. Production refuses an http origin.
- Rotating `BETTER_AUTH_SECRET` signs everyone out. It also makes the stored TOTP secrets and backup
  codes unreadable, because they are encrypted with it, so everyone's two-factor authentication would
  have to be set up again. Rotate it only after a compromise, and plan for that.
- This is not legal advice. Your privacy notice and your data processing agreements with the mail and
  hosting providers are yours to write.
