# Product Foundation (Phase 2, Plan 2a of 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new repository `cmp.clovetek.com` with a deployable Astro app where a person can sign up, verify their email, secure the login with 2FA or a passkey, create or join an account, invite members with roles, and reach the admin only when the account is paid (set by hand by the super-admin), with every word translatable, strict security headers, tenant isolation enforced in the database, and an audit log.

**Architecture:** One Astro app (Node adapter, `output: 'server'`, per-page `prerender`) with React islands and shadcn components, plus a separate worker process from the same codebase for background jobs. Postgres through Drizzle; tenant isolation in two layers: a scoped data-access API that cannot run a tenant query without an account scope, and Postgres row-level security keyed on a per-transaction setting. Better Auth provides sign-in, email verification, TOTP 2FA, passkeys, sessions, and accounts/members/invitations (its organization plugin, called "account" in the product). pg-boss runs jobs (email first). Paraglide JS provides typed message catalogs; a check fails the build if words appear in source.

**Tech Stack:** Node 24, TypeScript (strict), Astro 7 + `@astrojs/node` + `@astrojs/react`, React, Tailwind CSS 4, shadcn/ui, Paraglide JS (inlang), Drizzle ORM + drizzle-kit, Postgres 17, Better Auth (email/password, `twoFactor`, `passkey`, `organization`, `admin`, `haveIBeenPwned` plugins), pg-boss, nodemailer (SMTP), zod, vitest, Playwright + `@axe-core/playwright`, Docker.

**Spec:** `docs/superpowers/specs/2026-11-10-hosted-cmp-design.md` in the cloveconsent repo (sections Decided by the author, Architecture, Tenancy and roles, Billing account states, Admin UI, Security, Testing, i18n goal 8). Copied into the new repo by Task 1.

**Plans in this phase:** 1 Standalone runtime (merged) · **2a Product foundation (this plan)** · 2b Sites, publishing, runtime delivery, consent records · 3 Scanner and blocking check · 4 Billing interface, manual provider, one-time export · 5 Public site. Each later plan is written when its predecessor is merged.

## Global Constraints

- Repository: `D:\Projects\cmp.clovetek.com`, new git repo, default branch `main`, work on a feature branch. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Every dependency pinned to an exact version (no `^`/`~`), the latest stable at install time; `npm audit --omit=dev --audit-level=high` clean. The cloveconsent library is a git dependency pinned to a release tag: `"cloveconsent": "github:KaktusBR/CloveConsent#v<version>"` (release tags carry `dist/`). If no tag exists that contains `./site-script` and `./standalone`, stop and report.
- Verification before the last task is done: `npm run typecheck`, `npm run lint`, `npm run check:words`, `npm test`, `npm run test:db`, `npm run test:e2e` all pass.
- "No user-facing words live in source files": every visible string of pages, components, emails and API error messages comes from the Paraglide catalog (`messages/en.json` is the source; `messages/sk.json` ships too). `npm run check:words` fails on literal text in `.astro`/`.tsx` text nodes and on user-visible string attributes (`title`, `alt`, `placeholder`, `aria-label`, `label`).
- Security headers on every response: CSP without `unsafe-inline`/`unsafe-eval` (nonce or hash), `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying camera, microphone, geolocation, payment, usb, `frame-ancestors 'none'` (in CSP) and `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`.
- Session cookies HttpOnly, Secure, SameSite=Lax, `__Secure-` prefix in production. State-changing requests are protected against CSRF (origin check on every non-GET plus Better Auth's own protection).
- Tenant isolation: no module outside `src/server/data/` imports the database client (lint rule); every tenant table has `account_id` and an RLS policy; the app connects as a non-owner role so RLS applies.
- Accessibility: WCAG 2.2 AA; axe finds no violations on every page in the e2e suite; light and dark themes; keyboard-first.
- Containers run as non-root with a read-only root filesystem where possible; secrets only from the environment (validated at boot, never logged).
- Data in the EU; no third-party identity provider; no analytics.
- Not legal advice.

## Review Focus

1. A member of account A requests any route or API with account B's id in the path, body or a forged account-switch cookie: always 404 (never 403, which leaks existence) and nothing of B is read or changed. Pinned in Task 4 (data layer, RLS) and Task 9 (route sweep).
2. A user who has not verified their email, or has 2FA enabled but not completed the second step, cannot reach any admin page or API. Pinned in Task 6.
3. An account whose entitlement is `none` sees only the paywall and account settings, never site data; the super-admin marking it paid takes effect on the next request without re-login. Pinned in Task 8.
4. An invitation link used by a different signed-in email, used twice, or used after expiry or cancellation does nothing and says why. Pinned in Task 7.
5. A page in a language whose catalog lacks a key falls back to English for that key only, never shows a key id, and the check fails CI for missing keys in shipped languages. Pinned in Task 2.

---

## File Structure

- `astro.config.mjs`, `tsconfig.json`, `package.json`, `drizzle.config.ts`, `components.json` (shadcn), `project.inlang/settings.json`, `messages/en.json`, `messages/sk.json`.
- `src/server/env.ts`: environment schema (zod) and the parsed `env`.
- `src/server/data/`: `client.ts` (the only database client), `schema/*.ts` (Drizzle tables and RLS policies), `scope.ts` (`AccountScope`, `withAccount`, `asSystem`), `audit.ts`, repositories per area (`accounts.ts`, `entitlements.ts`).
- `src/server/auth/`: `auth.ts` (Better Auth instance), `permissions.ts` (access control and roles), `guard.ts` (route guards).
- `src/server/jobs/`: `queue.ts` (pg-boss), `mail.ts` (templates and sending).
- `src/worker.ts`: worker process entry.
- `src/middleware.ts`: security headers, locale, session, account scope, guards.
- `src/i18n/`: Paraglide output wiring, `locale.ts`.
- `src/components/ui/` (shadcn), `src/components/` (app components), `src/layouts/`, `src/pages/` (`[...locale]` routing as Task 2 decides), `src/pages/api/`.
- `scripts/check-words.ts`.
- `Dockerfile`, `compose.yaml` (dev: Postgres, Mailpit), `compose.prod.yaml` (Dokploy: app, worker), `.github/workflows/ci.yml`.
- Tests: `test/unit/**`, `test/db/**` (real Postgres), `e2e/**` (Playwright).

---

### Task 1: Repository, app shell, CI, container

**Files:**
- Create: everything listed under "File Structure" that is configuration, plus `src/pages/healthz.ts`, `src/pages/readyz.ts`, `src/server/env.ts`, `src/layouts/Base.astro`, `README.md`, `docs/` (copy of the phase 2 spec and this plan from the cloveconsent repo).
- Test: `test/unit/env.test.ts`, `e2e/health.spec.ts`

**Interfaces:**
- Produces: `env` (`DATABASE_URL`, `DATABASE_URL_MIGRATE` (owner role, migrations only), `BETTER_AUTH_SECRET` (≥32 bytes), `PUBLIC_ORIGIN` (https URL, http only for localhost), `SMTP_URL`, `MAIL_FROM`, `SUPER_ADMIN_EMAILS` (comma list), `NODE_ENV`), parsed once; invalid env throws at boot naming the variable but never printing its value.
- `GET /healthz` → 200 `ok` (process up); `GET /readyz` → 200 when the database answers `select 1`, else 503. Both excluded from auth, no-store.
- `log` (`src/server/log.ts`): structured JSON logger (pino) with redaction of `password`, `token`, `secret`, `cookie`, `authorization` paths and a request id per request; used by app and worker. Self-hosted error tracking is deferred to plan 5's operations work; logs go to stdout for Dokploy.

- [ ] **Step 1: Write failing tests:** the logger redacts `{ password: 'x', headers: { cookie: 'y' } }`; env parsing rejects a missing/short `BETTER_AUTH_SECRET`, an `http:` `PUBLIC_ORIGIN` that is not localhost, and never includes a secret value in the error message; Playwright `health.spec.ts` gets 200 from `/healthz`.
- [ ] **Step 2: Run** `npx vitest run test/unit/env.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Scaffold Astro 7 (Node adapter standalone, `output: 'server'`), React, Tailwind 4, shadcn (`components.json`, base components Button, Input, Label, Card, Dialog, DropdownMenu, Table, Toast/Sonner, Form), light/dark via class with system default, Base layout. `compose.yaml` with Postgres 17 and Mailpit for dev. Multi-stage `Dockerfile` (build, then a slim runtime image, non-root user, `NODE_ENV=production`, healthcheck on `/healthz`), same image runs the app (`node dist/server/entry.mjs`) or the worker (`node dist/worker.js`). CI: install, typecheck, lint (ESLint flat config with typescript-eslint and the restricted-import rule for the db client), tests with a Postgres service container, Playwright with Chromium, `npm audit`. README: dev setup with `docker compose up -d`, env vars, scripts.
- [ ] **Step 4: Run** `npm run typecheck && npm run lint && npm test && npm run test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `chore: Astro app shell, CI and container`.

### Task 2: Multilingual from the start

**Files:**
- Create: `project.inlang/settings.json`, `messages/en.json`, `messages/sk.json`, `src/i18n/locale.ts`, `scripts/check-words.ts`, `src/components/LocaleSwitcher.tsx`
- Modify: `astro.config.mjs` (i18n routing), `src/middleware.ts`, `src/layouts/Base.astro`
- Test: `test/unit/locale.test.ts`, `test/unit/check-words.test.ts`, `e2e/i18n.spec.ts`

**Interfaces:**
- Produces: `resolveLocale(pathname: string, cookie: string | null, acceptLanguage: string | null): Locale` (URL prefix wins, then cookie, then Accept-Language, then `en`); `localizedPath(path: string, locale: Locale): string`; `Astro.locals.locale`. English URLs have no prefix (`/sign-in`), other languages are prefixed (`/sk/sign-in`). `<html lang>` and `hreflang` alternates set by Base layout.
- Adding a language = adding `messages/<tag>.json` and the tag in `project.inlang/settings.json`; nothing else.

- [ ] **Step 1: Write failing tests:** `resolveLocale` order and `de-AT` → falls to `en` when `de` is not shipped; `check-words` flags `<p>Hello</p>` in a fixture `.astro` and `.tsx`, a literal `aria-label="Close"`, and passes `{m.close()}`, punctuation-only text, and code inside `<code>`; a missing key in `sk.json` makes the check fail while the page renders the English text for that key (Review Focus 5); e2e: `/sk/` renders Slovak with `lang="sk"`, the switcher keeps the current page.
- [ ] **Step 2: Run** the two unit files. Expected: FAIL.
- [ ] **Step 3: Implement** with Paraglide JS (compile step wired into dev/build/test; typed `m.*` functions). `check-words` parses `.astro` with `@astrojs/compiler` and `.tsx` with the TypeScript compiler API (AST, not regex); allow-list only via an explicit `// words-ok: <reason>` comment. Add `npm run check:words` to CI.
- [ ] **Step 4: Run** `npm run check:words && npm test && npm run test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(i18n): typed message catalogs, locale routing, no words in source`.

### Task 3: Security headers and CSRF

**Files:**
- Modify: `src/middleware.ts`, `astro.config.mjs`
- Create: `src/server/security.ts`
- Test: `test/unit/security.test.ts`, `e2e/security.spec.ts`

**Interfaces:**
- Produces: `securityHeaders(opts: { nonce: string; isProd: boolean }): Headers` and the CSP built from it (`default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic'; style-src 'self' 'nonce-<n>'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'; upgrade-insecure-requests`). Use Astro's built-in CSP support if the installed Astro provides it for server-rendered and prerendered pages; otherwise a per-request nonce injected by middleware. Prerendered pages get hash-based CSP.
- `checkOrigin(request, publicOrigin): boolean` for every non-GET/HEAD request (also enable Astro `security.checkOrigin`).

- [ ] **Step 1: Write failing tests:** every header from Global Constraints is present with the exact value on an SSR page, an API route, a 404 and a prerendered page; a POST with a foreign `Origin` gets 403; e2e: no CSP violation is reported on any page visited (listen to `securitypolicyviolation`), theme toggle and an island work under the CSP.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(security): strict CSP, security headers, origin check`.

### Task 4: Database, tenant scope, row-level security, audit log

**Files:**
- Create: `src/server/data/client.ts`, `src/server/data/schema/*.ts`, `src/server/data/scope.ts`, `src/server/data/audit.ts`, `drizzle/` (migrations), `scripts/migrate.ts`, `test/db/setup.ts`
- Test: `test/db/scope.test.ts`, `test/db/rls.test.ts`, `test/db/audit.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Role = 'owner' | 'admin' | 'editor' | 'viewer'
  export interface AccountScope { readonly accountId: string; readonly userId: string; readonly role: Role }
  export function withAccount<T>(scope: AccountScope, fn: (tx: TenantTx) => Promise<T>): Promise<T>   // one transaction, `set_config('app.account_id', id, true)`
  export function asSystem<T>(reason: string, fn: (tx: SystemTx) => Promise<T>): Promise<T>        // super-admin/worker only, audited
  export function audit(tx: TenantTx | SystemTx, e: { action: string; target?: string; meta?: Record<string, unknown>; actorUserId: string | null; accountId: string | null }): Promise<void>
  ```
- Database roles: `cmp_owner` (migrations, owns tables) and `cmp_app` (runtime, no BYPASSRLS). Every tenant table: `account_id uuid not null` + RLS policy `account_id = current_setting('app.account_id', true)::uuid`, `FORCE ROW LEVEL SECURITY`. System access uses a separate `cmp_system` role with policies limited to what it needs (documented), never the owner.
- `audit_log` table (append-only: no UPDATE/DELETE grant for `cmp_app`), with `created_at`, actor, account, action, target, meta (no secrets, no passwords, no tokens).

- [ ] **Step 1: Write failing tests** (real Postgres, migrations applied from scratch per run): a query through `withAccount(A)` never returns B's rows; a raw query as `cmp_app` without the setting returns zero tenant rows; trying to UPDATE or DELETE `audit_log` as `cmp_app` fails; `audit` rejects meta keys named `password`, `token`, `secret`; ESLint fails a fixture that imports `src/server/data/client.ts` from `src/pages/` (Review Focus 1, data layer).
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL.
- [ ] **Step 3: Implement.** Migrations via drizzle-kit, applied by `scripts/migrate.ts` with `DATABASE_URL_MIGRATE` (also run on container start of a one-shot migrate service, never by the app role). Test setup creates a fresh database per test run and the roles.
- [ ] **Step 4: Run** `npm run test:db && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(data): Drizzle schema, tenant scope with row-level security, audit log`.

### Task 5: Job queue and email

**Files:**
- Create: `src/server/jobs/queue.ts`, `src/server/jobs/mail.ts`, `src/emails/*.tsx` (templates rendered to HTML and text), `src/worker.ts`
- Test: `test/db/queue.test.ts`, `test/unit/mail.test.ts`

**Interfaces:**
- Produces: `enqueue<N extends JobName>(name: N, data: JobData[N], opts?: { singletonKey?: string; startAfter?: Date }): Promise<string>`; `JobName` starts with `'mail.send'`; `sendMail(input: { to: string; template: MailTemplate; locale: Locale; data: Record<string, string> }): Promise<void>` (enqueues; the worker renders and sends). Templates: `verify-email`, `reset-password`, `invitation`, `two-factor-changed`, `new-sign-in` (subject and body from the catalog; HTML and plain text; no remote images).
- Worker: graceful shutdown on SIGTERM, retries with backoff (max 5), dead-letter state visible in logs.

- [ ] **Step 1: Write failing tests:** a `mail.send` job reaches a captured SMTP (Mailpit in dev/CI or an in-memory transport in unit tests) with the subject in the requested locale; a template variable containing `<script>` is escaped in HTML; a failing SMTP retries and then dead-letters; enqueue is part of the caller's transaction when given one (no email if the transaction rolls back).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run test:db`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(jobs): pg-boss queue, worker, translated transactional email`.

### Task 6: Sign-up, sign-in, verification, 2FA, passkeys, sessions

**Files:**
- Create: `src/server/auth/auth.ts`, `src/server/auth/guard.ts`, `src/pages/api/auth/[...all].ts`, pages `sign-up`, `sign-in`, `verify-email`, `forgot-password`, `reset-password`, `two-factor`, `account/security` (2FA setup with QR and backup codes, passkeys, active sessions with revoke), React islands for the forms.
- Test: `test/db/auth.test.ts`, `e2e/auth.spec.ts`

**Interfaces:**
- Better Auth with the Drizzle adapter, `emailAndPassword` (`requireEmailVerification: true`, min length 12, max 128), `haveIBeenPwned`, `twoFactor` (TOTP, backup codes, `appName` from the catalog), `passkey` (rpID from `PUBLIC_ORIGIN`), built-in rate limiting stored in the database (sign-in, sign-up, password reset, 2FA verify), session cookie config from Global Constraints, `trustedOrigins: [PUBLIC_ORIGIN]`. Auth emails go through `sendMail`.
- `requireUser(Astro): { user, session }` redirects to `/sign-in?next=` (same-origin path only) when there is no complete session; a session pending its second factor counts as no session.

- [ ] **Step 1: Write failing tests:** unverified users cannot sign in to the admin (Review Focus 2); a breached password is refused with a translated message; 2FA-enabled user without the TOTP step gets no admin page or API (Review Focus 2); backup code works once; `next=` with `//evil.example` or `https://evil.example` is ignored; repeated failed sign-ins are rate limited; revoking a session from Security logs that browser out; enabling/disabling 2FA sends `two-factor-changed`; e2e full flow: sign up → email in Mailpit → verify → set up TOTP → sign out → sign in with TOTP → add passkey (Chromium virtual authenticator) → sign in with passkey; axe clean on every auth page.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:db && npm run test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(auth): email sign-up with verification, TOTP 2FA, passkeys, sessions`.

### Task 7: Accounts, members, roles, invitations

**Files:**
- Create: `src/server/auth/permissions.ts`, `src/server/data/accounts.ts`, pages `accounts/new`, `account/members`, `invite/[token]`, `src/components/AccountSwitcher.tsx`
- Modify: `src/server/auth/auth.ts` (organization plugin), `src/middleware.ts` (active account → `locals.scope`)
- Test: `test/db/accounts.test.ts`, `e2e/members.spec.ts`

**Interfaces:**
- Better Auth `organization` plugin is the product's "account" (tables renamed or aliased so the product code says account). Access control statement (product resources, used by later plans): `site: [create, update, publish, delete]`, `records: [read, export, delete]`, `member: [invite, update, remove]`, `billing: [manage]`, `account: [update, delete]`. Roles: `owner` all; `admin` all except `billing:manage` and `account:delete`; `editor` `site: [create, update, publish]` and `records: [read]`; `viewer` `records: [read]`. At least one owner always remains.
- `can(scope: AccountScope, resource, action): boolean`; `locals.scope: AccountScope | null` from the active account, re-checked against membership on every request.
- Invitations: email-bound, 7-day expiry, single use, cancellable; accepting requires being signed in with the invited email.

- [ ] **Step 1: Write failing tests:** role matrix for every (role, resource, action); removing the last owner is refused; invitation used by another email, twice, after expiry or after cancellation does nothing and shows the reason (Review Focus 4); switching to an account the user is not a member of is refused and the active account stays; membership removal takes effect on the next request; every member change writes `audit_log`; e2e: owner invites an editor, editor accepts and sees the account, cannot open Members management; axe clean.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:db && npm run test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(accounts): accounts, roles, invitations, account switcher`.

### Task 8: Entitlement, paywall, super-admin

**Files:**
- Create: `src/server/data/entitlements.ts`, `src/server/data/schema/plans.ts`, pages `paywall`, `admin/accounts`, `admin/accounts/[id]`, `admin/audit`
- Modify: `src/middleware.ts` (entitlement guard), `src/server/auth/auth.ts` (`admin` plugin, super-admins from `SUPER_ADMIN_EMAILS`)
- Test: `test/db/entitlements.test.ts`, `e2e/super-admin.spec.ts`

**Interfaces:**
- Plans are data (`plans` table seeded by migration: id, name key, limits JSON `{ sites, languages, scansPerMonth, recordsPerMonth, members }`), not code.
- `entitlementOf(accountId: string, now?: Date): { state: 'active' | 'grace' | 'necessary-only' | 'none'; planId: string | null; paidUntil: Date | null; graceEndsAt: Date | null }`: `active` until `paidUntil`; `grace` for 30 days after `paidUntil` or after suspension; `necessary-only` after that; `none` if never paid. (The runtime consequences of `grace`/`necessary-only` are implemented in plan 2b; here the admin access rule is: `active` and `grace` can use the admin, `necessary-only` and `none` see the paywall and account settings only.)
- The super-admin's catalog overlay, placeholder texts and system health screens belong to plan 2b and later; this task builds the console shell they plug into.
- Super-admin (`/admin/*`, only users listed in `SUPER_ADMIN_EMAILS` with 2FA enabled): list and search accounts, set plan and `paidUntil` by hand, suspend/unsuspend, read-only impersonation (Better Auth admin plugin, writes blocked while impersonating, banner shown, time-limited), audit log viewer. Every super-admin action audited with the reason field required.

- [ ] **Step 1: Write failing tests:** state transitions at the exact boundaries (paidUntil, +30 days); an unpaid account gets only the paywall and account settings for every admin route and API (Review Focus 3); marking paid takes effect on the next request without re-login (Review Focus 3); a non-listed user gets 404 on `/admin/*`; a listed user without 2FA is sent to set it up; impersonation cannot POST/PUT/DELETE anything; every super-admin action appears in `audit_log` with actor and reason; axe clean.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:db && npm run test:e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(entitlement): paid access gate, plans as data, super-admin console`.

### Task 9: Tenant-isolation sweep, end-to-end flow, deployment

**Files:**
- Create: `test/db/isolation.test.ts`, `e2e/isolation.spec.ts`, `e2e/journey.spec.ts`, `compose.prod.yaml`, `docs/deploy-dokploy.md`
- Modify: `README.md`

**Interfaces:**
- The isolation sweep enumerates every route and API endpoint from the Astro route manifest (not a hand-written list) so a new route without a test fails the sweep.

- [ ] **Step 1: Write the suites:** for every account-scoped route and API: a member of account A requests it with B's identifiers (path, query, body, forged active-account cookie) and gets 404 with nothing of B in the body, logs or database changes (Review Focus 1); the sweep fails when a route exists that it does not cover; journey: sign up → verify → create account → super-admin marks paid → invite member → member accepts → both see the (empty) sites area, in English and Slovak; axe clean on every page visited.
- [ ] **Step 2: Run** `npm run test:db && npm run test:e2e`. Expected: PASS (fix code, not tests).
- [ ] **Step 3: Deployment:** `compose.prod.yaml` for Dokploy (app and worker from one image, one-shot migrate service with the owner role, Postgres connection via env, healthchecks, read-only root filesystem with a tmpfs for `/tmp`, non-root, resource limits), and `docs/deploy-dokploy.md` (env vars, secrets, DNS, TLS, backups: daily encrypted `pg_dump` with a restore test procedure).
- [ ] **Step 4: Run** `npm run typecheck && npm run lint && npm run check:words && npm test && npm run test:db && npm run test:e2e` and `docker build .`. Expected: all PASS.
- [ ] **Step 5: Commit** `test: tenant-isolation sweep and full journey; Dokploy deployment`.
