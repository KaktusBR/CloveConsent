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
| `PUBLIC_ORIGIN` | yes | the app's public origin, e.g. `https://consent.example`; `http` only for `localhost`, `127.0.0.1`, `[::1]` and never with `NODE_ENV=production`; no path. Links, cookies and emails derive from it: no domain is written in the code |
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
| `npm run i18n` | compiles the catalogs into `src/paraglide/` (generated, not in git); `dev`, `build`, `typecheck` and `test` run it first |
| `npm run check:words` | fails on user-visible text written in `.astro`/`.tsx` sources and on incomplete catalogs (see Languages) |
| `npm test` | unit tests (Vitest) |
| `npm run test:e2e` | builds, starts the built server and runs Playwright (Chromium); needs `docker compose up -d` |

## Languages

Every visible word comes from the Paraglide catalogs: `messages/en.json` is the source, `messages/sk.json`
ships too. Use the typed functions: `import { m } from '@/paraglide/messages.js'`, then `{m.home_heading()}`.

- URLs: English has no prefix (`/sign-in`), other languages do (`/sk/sign-in`). Pages exist once, unprefixed;
  `src/middleware.ts` serves the prefixed URL from the same page and sets `Astro.locals.locale`.
- Language of a request (`resolveLocale` in `src/i18n/locale.ts`): the URL prefix, else the `locale` cookie
  (set by the language switcher), else `Accept-Language` (`de-AT` also tries `de`), else English. A page load
  of an unprefixed URL whose language is not English is redirected (307) to its prefixed URL.
- Links to a page in a language: `localizedPath('/sign-in', locale)`. `Base.astro` sets `<html lang>`,
  the `hreflang` alternates and the language switcher.
- Adding a language: add `messages/<tag>.json` (with every key of `en.json`) and the tag to `locales` in
  `project.inlang/settings.json`. Nothing else.
- A key missing from a translation shows the English text, and `npm run check:words` fails.
- `check:words` parses sources (it does not grep): text in markup and literal `title`, `alt`, `placeholder`,
  `label`, `aria-label` (and other text-carrying `aria-*`, and `...Label` props) fail. Code, `<code>`, `<pre>`,
  punctuation and numbers pass. A deliberate exception needs `// words-ok: <reason>` on the line or the line
  above. Machine responses in `.ts` endpoints (`/healthz`'s `ok`) are not user-facing text.

## Health

- `GET /healthz`: `200 ok` while the process is up.
- `GET /readyz`: `200` when the database answers `select 1`, else `503`.

Both are uncached (`Cache-Control: no-store`) and need no sign-in. Every response carries an
`X-Request-Id`; logs are JSON lines on stdout with that id, and any field whose name contains
authorization, cookie, password, secret, token, api key or database URL (any case, any depth) is redacted.

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
