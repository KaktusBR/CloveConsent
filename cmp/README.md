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

# 5. Run
npm run dev             # http://localhost:4321
```

`docker compose down` stops the services; add `-v` to delete the database volume.

## Environment

Validated once at start-up by `src/server/env.ts`. An invalid or missing variable stops the process with
an error that names the variable and what it must be; values are never printed or logged.

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | `postgres://` URL for the app (a non-owner role, so row-level security applies) |
| `DATABASE_URL_MIGRATE` | yes | `postgres://` URL for the owner role; migrations only |
| `DATABASE_URL_SYSTEM` | yes | `postgres://` URL for the system role; audited system work only |
| `BETTER_AUTH_SECRET` | yes | at least 32 bytes |
| `PUBLIC_ORIGIN` | yes | the app's public origin, e.g. `https://consent.example`; `http` only for `localhost`, `127.0.0.1`, `[::1]`; no path. Links, cookies and emails derive from it: no domain is written in the code |
| `SMTP_URL` | yes | `smtp://` or `smtps://` URL |
| `MAIL_FROM` | yes | `address` or `Name <address>` |
| `SUPER_ADMIN_EMAILS` | no | comma-separated email addresses |
| `NODE_ENV` | no | `development` (default), `test` or `production` |

The container also reads `HOST` and `PORT` (defaults `0.0.0.0` and `4321`).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Astro dev server, with `.env` loaded |
| `npm run build` | builds the app (`dist/server/entry.mjs`) and the worker (`dist/worker.js`) |
| `npm start` / `npm run worker` | runs the built app / worker, with `.env` loaded if present |
| `npm run typecheck` | `astro check` and `tsc --noEmit` (pages, sources, tests, configs) |
| `npm run lint` | ESLint; only `src/server/data/` may import the database driver or client |
| `npm test` | unit tests (Vitest) |
| `npm run test:e2e` | builds, starts the built server and runs Playwright (Chromium); needs `docker compose up -d` |

## Health

- `GET /healthz`: `200 ok` while the process is up.
- `GET /readyz`: `200` when the database answers `select 1`, else `503`.

Both are uncached (`Cache-Control: no-store`) and need no sign-in. Every response carries an
`X-Request-Id`; logs are JSON lines on stdout with that id, and passwords, tokens, secrets, cookies
and authorization headers are redacted.

## Container

One image runs either process. Build from the repository root (the image builds the library first):

```sh
docker build -f cmp/Dockerfile -t cloveconsent-cmp .
docker run --read-only --env-file cmp/.env -p 4321:4321 cloveconsent-cmp            # app
docker run --read-only --env-file cmp/.env cloveconsent-cmp node dist/worker.js      # worker
```

Inside a container `localhost` is the container itself: point the URLs at the database and SMTP hosts
it can reach (for the compose services on Docker Desktop, `host.docker.internal`).

It runs as the unprivileged `node` user with `NODE_ENV=production`, works with a read-only root
filesystem, and has a health check on `/healthz`.
