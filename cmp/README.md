# cloveconsent hosted app (`cmp/`)

The hosted consent-management app. It lives in this folder of the cloveconsent repository, has its own
`package.json`, lockfile, tooling and CI (`../.github/workflows/cmp.yml`), and uses the library from the
parent folder as `"cloveconsent": "file:.."`. The library's own tooling, CI and releases ignore `cmp/`:
a change only here never releases the library.

Stack: Node 24, Astro 7 (Node adapter, standalone, `output: 'server'`), React, Tailwind CSS 4, shadcn/ui,
zod (environment), pino (logs), Postgres 17.

## Development

Requirements: Node 24, Docker.

```sh
# 1. Build the library once (and after changing it): the app installs it from ../
cd ..
npm ci --ignore-scripts
npm run build
cd cmp

# 2. Install the app
npm ci

# 3. Postgres 17 and Mailpit (SMTP on localhost:1025, inbox at http://localhost:8025)
docker compose up -d

# 4. Environment
cp .env.example .env    # then set BETTER_AUTH_SECRET (see the comment in the file)
cp .env.db.example .env.db   # owner and admin URLs, read only by db:init and db:migrate

# 5. Database roles, database and migrations (see Database)
npm run db:init
npm run db:migrate

# 6. Run
npm run dev             # http://localhost:4321
```

`docker compose down` stops the services; add `-v` to delete the database volume (then run step 5 again).
A volume created before the three roles existed (superuser `cmp`) must be deleted once:
`docker compose down -v && docker compose up -d`.

## Environment

Validated once at start-up by `src/server/env.ts`. An invalid or missing variable stops the process with
an error that names the variable and what it must be; values are never printed or logged.

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | `postgres://` URL as `cmp_app`, the runtime role (row-level security applies) |
| `DATABASE_URL_SYSTEM` | yes | `postgres://` URL as `cmp_system`; audited system work only |
| `BETTER_AUTH_SECRET` | yes | at least 32 bytes |
| `PUBLIC_ORIGIN` | yes | the app's public origin, e.g. `https://consent.example`; `http` only for `localhost`, `127.0.0.1`, `[::1]` and never with `NODE_ENV=production`; no path. Links, cookies and emails derive from it: no domain is written in the code |
| `SMTP_URL` | yes | `smtp://` or `smtps://` URL |
| `MAIL_FROM` | yes | `address` or `Name <address>` |
| `SUPER_ADMIN_EMAILS` | no | comma-separated email addresses |
| `NODE_ENV` | no | `development` (default), `test` or `production` |
| `TRUSTED_PROXIES` | no | comma-separated IP addresses or CIDR ranges of the reverse proxies whose `X-Forwarded-For` names the client (not `/0`); empty (default): the connection's peer is the client. See Sign-in |

Not in the app's environment, on purpose (the owner role can turn row-level security off): these live in
`.env.db` (from `.env.db.example`) and are read only by the database scripts, never by the app or worker.

| Variable | Read by | Meaning |
|---|---|---|
| `DATABASE_URL_MIGRATE` | `db:migrate`, `db:init`, `test:db` | `postgres://` URL as `cmp_owner`; migrations only |
| `DATABASE_URL_ADMIN` | `db:init`, `test:db` | a role that may create roles and databases (locally the compose superuser) |

The container also reads `HOST` and `PORT` (defaults `0.0.0.0` and `4321`).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Astro dev server, with `.env` loaded |
| `npm run build` | builds the app (`dist/server/entry.mjs`) and the worker (`dist/worker.js`) |
| `npm start` / `npm run worker` | runs the built app / worker, with `.env` loaded if present |
| `npm run typecheck` | `astro check` and `tsc --noEmit` (pages, sources, tests, configs) |
| `npm run lint` | ESLint; only `src/server/data/` may import the database driver or client |
| `npm run i18n` | compiles the catalogs into `src/paraglide/` (generated, not in git); `dev`, `build`, `typecheck` and `test` run it first |
| `npm run check:words` | fails on user-visible text written in `.astro`/`.tsx` sources and on incomplete catalogs (see Languages) |
| `npm test` | unit tests (Vitest) |
| `npm run test:db` | database tests against the compose Postgres: creates the roles and a fresh database, migrates it from scratch, drops it at the end (needs `DATABASE_URL_ADMIN`, defaults to the compose superuser) |
| `npm run db:init` | creates or updates the three roles and the database (reads `.env` and `.env.db`; idempotent) |
| `npm run db:generate` | writes a migration to `drizzle/` from `src/server/data/schema/` (then add FORCE RLS and grants by hand, see Database) |
| `npm run db:migrate` | applies the migrations as `cmp_owner` (reads `.env.db` only; refuses any other role) |
| `npm run test:e2e` | builds, starts the built server and runs Playwright (Chromium); every visited page is checked with axe (WCAG 2.2 AA, light and dark: `e2e/axe.ts`); needs `docker compose up -d` |

## Languages

Every visible word comes from the Paraglide catalogs: `messages/en.json` is the source, `messages/sk.json`
ships too. Use the typed functions: `import { m } from '@/paraglide/messages.js'`, then `{m.home_heading()}`.

- URLs: English has no prefix (`/sign-in`), other languages do (`/sk/sign-in`). Pages live under
  `src/pages/[...locale]/` (optional first segment): one file answers both URLs. A server-rendered page
  checks the segment with `localeFromParam(Astro.params.locale)` (anything else is a 404); a prerendered one
  exports `getStaticPaths = localeStaticPaths` and is built once per language (`dist/client/sk/index.html`).
- The language of a page is its URL, nothing else (`localeOfPath`): an unprefixed URL is always English,
  `/sk/...` always Slovak. No redirect on Accept-Language or cookie. The middleware sets
  `Astro.locals.locale` from it (also while prerendering).
- The switcher (`src/components/LocaleSwitcher.astro`, in `Base.astro`) is plain links to
  `GET /api/locale?to=sk&next=/current/page`, which stores the choice in the `locale` cookie and redirects
  (303) to the same page in that language; `next` must be a path on this site. Works without JavaScript.
  `preferredLocale(cookie, acceptLanguage)` reads that choice for responses with no language in the URL
  (emails, API errors).
- Links to a page in a language: `localizedPath('/sign-in', locale)`. `Base.astro` sets `<html lang>`,
  `<link rel="canonical">` and the `hreflang` alternates (not on the 404 page: `indexable={false}`).
- Prerendered pages link to `PUBLIC_ORIGIN`, so the build needs it too (only that variable; the image
  takes it as `--build-arg PUBLIC_ORIGIN=...`).
- Adding a language: add `messages/<tag>.json` (with every key of `en.json`) and the tag to `locales` in
  `project.inlang/settings.json`. Nothing else.
- A key missing from a translation shows the English text, and `npm run check:words` fails.
- `check:words` parses sources (it does not grep): text in markup (also markup passed in an attribute),
  string literals rendered as children (also in `?:`, `??`, `||`, `&&` branches), and literal `title`, `alt`,
  `placeholder`, `label`, `aria-label` (and other text-carrying `aria-*`, `...Label` props, `set:text`, the
  `value` of submit/button inputs, `content` of description and social text `<meta>`) fail. Code, `<code>`,
  `<pre>`, punctuation and numbers pass. A deliberate exception needs `// words-ok: <reason>` on the line or the line
  above. Machine responses in `.ts` endpoints (`/healthz`'s `ok`) are not user-facing text.

## Database

Postgres 17 with Drizzle. Only `src/server/data/` talks to the database (lint rule `cmp/data-layer-only`);
the one exception is `authDatabase` (`src/server/data/auth-database.ts`), the handle for Better Auth's
identity tables, importable only from `src/server/auth/`.

Roles (created by `npm run db:init`, `scripts/db-init.ts`, run once per server with `DATABASE_URL_ADMIN`;
not by a migration, because creating roles needs a privilege the owner must not have):

| Role | URL | Can |
|---|---|---|
| `cmp_owner` | `DATABASE_URL_MIGRATE` | runs migrations, owns the database and every table; has no row policy, so it reads no tenant rows either |
| `cmp_app` | `DATABASE_URL` | the app at runtime: only the rows of the account set by `withAccount` |
| `cmp_system` | `DATABASE_URL_SYSTEM` | `asSystem` (super-admin, worker): only what each table's policies grant it |

None is a superuser, bypasses row-level security, creates roles or databases, or is a member of another.

Tenant data:

- Every tenant table has `account_id uuid not null`, row-level security enabled and forced, explicit grants,
  and `cmp_app` policies `account_id = nullif(current_setting('app.account_id', true), '')::uuid` (the
  `nullif` keeps a pooled connection that once had the setting from failing with `''::uuid`).
  `test/db/rls.test.ts` checks every table in the catalog against this; identity tables are listed there.
- `withAccount(scope, fn)` (`src/server/data/scope.ts`) runs `fn` in one transaction with
  `app.account_id` set for that transaction only. Without it the app role sees no tenant rows.
- `asSystem(reason, fn)` runs `fn` on the system role; the access and its reason are written to the
  audit log first.
- `audit(tx, event)` (`src/server/data/audit.ts`) appends to `audit_log` in the caller's transaction and
  refuses `meta` keys that look like secrets (password, token, secret, cookie, authorization, API key).
  `audit_log` is append-only: `cmp_app` and `cmp_system` may SELECT and INSERT the event columns only
  (never `id` or `created_at`, so no row is backdated), never UPDATE or DELETE.
- A transaction handle given to a `withAccount`/`asSystem` callback throws once the callback has
  returned: keep it inside the callback.
  The app reads and writes only its account's rows; system and global events (no account) are written
  and read by the system role.

Migrations: `npm run db:generate` after changing the schema. drizzle-kit does not emit
`FORCE ROW LEVEL SECURITY` or grants: add them to the generated SQL (as in `drizzle/0000_audit_log.sql`
and the column grants of `drizzle/0001_audit_log_column_grants.sql`). The sweep in `test/db/rls.test.ts`
fails on any permissive policy the app role can use (its own, PUBLIC's or an inherited role's) whose
expression is not exactly the account rule.
In production the image runs them as a one-shot service before the app: `node scripts/migrate.ts`
(needs only `DATABASE_URL_MIGRATE`, which the app and worker containers never receive).

## Jobs and email

Background jobs use pg-boss in its own schema, `pgboss`, installed by a migration as the owner
(`drizzle/0002_job_queue.sql`); pg-boss never changes the schema at runtime. Upgrading pg-boss is a new
migration from `getMigrationPlans('pgboss', <installed version>)`: the worker refuses to start on a
schema of another version. The queue is not tenant data (no row-level security): a job carries what one
task needs, never an account's records or secrets.

| Role | Can in `pgboss` |
|---|---|
| `cmp_app` | enqueue: read the queue settings, insert a job and read back its id; never read a job's data |
| `cmp_system` | the worker: fetch, complete, fail, retry, clean up (DML on its tables, no DDL) |

- `enqueue(name, data, { tx })` (`src/server/jobs/queue.ts`): with `tx` (from `withAccount`/`asSystem`)
  the job exists only if that transaction commits.
- `sendMail({ to, template, locale, data }, { tx })` (`src/server/jobs/mail.ts`) checks the mail and
  queues it; the worker renders it (`src/emails/*.tsx`: subject and body from the catalog, HTML and plain
  text, no remote content) and sends it over `SMTP_URL`. Links must be on `PUBLIC_ORIGIN`.
- A failed mail is retried 5 times with backoff (30 s doubling, at most an hour), then moved to
  `mail.send.dead` and logged as `mail dead-lettered`. A job whose data is not a valid mail goes there at
  once. Logs never carry the recipient, links or bodies.
- Once a mail job is done (sent, invalid or out of retries) its stored data is cut down to template and
  language: no recipient, and no link (links can carry one-time tokens), in the job or its dead-letter
  copy. A failure is stored as code and SMTP reply code only.
- Only the owner may run pg-boss's schema-changing SQL functions; the runtime roles run `job_now()`, and
  the worker also `create_queue()` for its scheduler's own queue, which without a table of its own is an
  insert it may do anyway (`drizzle/0003_job_queue_functions.sql`, `drizzle/0005_auth_cleanup.sql`). The owner's new functions get no EXECUTE for PUBLIC: grant
  what the runtime roles need in the migration that creates a function.
- App and worker refuse to start when the `pgboss` schema is not the version their pg-boss expects
  (`QueueSchemaError`: apply the migrations).
- The worker stops on SIGTERM or SIGINT, also during startup: it takes no new job, lets the ones in hand
  finish (up to 30 s; a job still running then is left to the queue, which expires and retries it) and
  exits 0. It exits 1 when it cannot start, or if stopping throws.
  `test/db/worker-process.test.ts` checks this on Linux (CI); Windows has no signals to send.

## Sign-in

Better Auth (`src/server/auth/auth.ts`), answering at `/api/auth/*`; pages `/sign-up`, `/sign-in`,
`/verify-email`, `/forgot-password`, `/reset-password`, `/two-factor`, `/account/security` (each also
under `/sk/`).

- Email and password (12 to 128 characters, refused when Have I Been Pwned knows it: only the first five
  characters of its SHA-1 leave the server). Signing in needs a confirmed address; a confirmation link
  never signs anyone in. A password reset signs out every session.
- Second factor: TOTP with 10 single-use backup codes (both stored encrypted with
  `BETTER_AUTH_SECRET`); "trust this device" is refused. Passkeys (WebAuthn, relying party = the host of
  `PUBLIC_ORIGIN`, user verification required) count as both factors.
- `requireUser(Astro)` / `completeSession(headers)` (`src/server/auth/guard.ts`) accept a session only
  when the address is confirmed and, for a user with 2FA on, the session was created by the second step
  or a passkey, or replaced a session that was (`auth_session.second_factor`; e.g. change-password).
  Turning 2FA on ends the user's other sessions.
- Sessions live in the database (7 days, sliding: a page render renews one older than a day, cookie
  included; no cookie cache, so revoking is immediate). Cookies:
  `cmp.session_token`, HttpOnly, SameSite=Lax, and `__Secure-` + Secure when `PUBLIC_ORIGIN` is https.
- Rate limits are stored in `auth_rate_limit` (shared by every process, survive restarts), per client
  address and path: sign-in 5/min, sign-up 3/min, reset request 3/5 min, reset 5/5 min, resend
  confirmation 3/5 min, second-factor codes 5/min (and 10 wrong codes lock the second step for 15 min),
  passkey sign-in 10/min, anything else 100/min; and per account, from any address, sign-in 10 per 15
  min (keyed by a hash of the email address; a passkey still works then).
- The client address is never a header the client chose (`src/server/auth/handler.ts`,
  `src/server/client-address.ts`): it is the connection's peer, unless that peer is listed in
  `TRUSTED_PROXIES`, in which case `X-Forwarded-For` is read right to left past the trusted proxies.
  A request whose address is unknown is refused (no shared bucket). **Behind Dokploy's Traefik**, set
  `TRUSTED_PROXIES` to the address range Traefik connects from (its Docker network, e.g. the
  `dokploy-network` subnet) and nothing wider; the app port must not be reachable except through
  Traefik. Without it every request counts as coming from Traefik, so all clients share one limit.
- A worker job, `auth.cleanup` (pg-boss scheduler, every 15 minutes), deletes expired sessions and
  challenges and rate-limit rows idle for over an hour: they hold client addresses and user agents.
- Auth mail (confirmation, reset, 2FA on/off) goes through `sendMail` in the language of the page the
  request came from. Better Auth gives its mail callbacks no transaction: a mail is queued on its own
  (a failure to queue fails the request; at worst a mail for a change later rolled back, whose link then
  does not work).
- Tables `auth_*` (`src/server/data/schema/auth.ts`): identity data, no `account_id`, no row-level
  security; only `cmp_app` may use them, with the privileges listed in `test/db/rls.test.ts`. Created by
  the migrations; Better Auth never migrates at runtime.

## Health

- `GET /healthz`: `200 ok` while the process is up.
- `GET /readyz`: `200` when the database answers `select 1`, else `503`.

Both are uncached (`Cache-Control: no-store`) and need no sign-in. Every response carries an
`X-Request-Id`; logs are JSON lines on stdout with that id, and any field whose name contains
authorization, cookie, password, secret, token, api key or database URL (any case, any depth) is redacted.

## Container

One image runs either process. Build from the repository root (the image builds the library first):

```sh
docker build -f cmp/Dockerfile --build-arg PUBLIC_ORIGIN=https://consent.example -t cloveconsent-cmp .
docker run --read-only --env-file cmp/.env -p 4321:4321 cloveconsent-cmp            # app
docker run --read-only --env-file cmp/.env cloveconsent-cmp node dist/worker.js      # worker
docker run --read-only --env-file cmp/.env.db cloveconsent-cmp node scripts/migrate.ts  # migrations, one-shot
```

Inside a container `localhost` is the container itself: point the URLs at the database and SMTP hosts
it can reach (for the compose services on Docker Desktop, `host.docker.internal`).

It runs as the unprivileged `node` user with `NODE_ENV=production`, works with a read-only root
filesystem, and has a health check on `/healthz`.
