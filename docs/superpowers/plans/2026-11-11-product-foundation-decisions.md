# Product foundation (plan 2a): decisions to review

Branch `feat/product-foundation` (head `0ac8954`, 38 commits ahead of `main`, not pushed).
Plan: `docs/superpowers/plans/2026-11-11-product-foundation.md` · Spec: `docs/superpowers/specs/2026-11-10-hosted-cmp-design.md`.
The app lives in `cmp/`.

Every decision below was made during the build without asking you. Each has the reason and what it costs if it turns out wrong.
Go through them, and mark any you want changed.

## Open questions only you can answer

1. **How to finish the branch:** merge locally, push and open a pull request, or keep it as-is.
2. **Broken library release.** `.github/workflows/release.yml` calls `scripts/version.mjs next`, but an earlier commit removed that command.
   - This was already broken before plan 2a.
   - Merging this branch touches library files, so the next push to `main` starts a release run that fails.
   - Fix it before or after the merge, as its own small piece of work?
3. **Limit numbers** (decisions 21 and 22). Are they right for your customers?
4. **Things left for later** (see the end). Which of them should be done before plan 2b?
5. **The Dokploy steps** in `cmp/docs/deploy-dokploy.md` have not been run on a real server yet. When do you want to try a real deploy?

## Your own decisions (for reference)

- The product stays in this repo, in `cmp/`. No domain is written into the code.
- The work is built with a fresh subagent per task.
- The ~45 KB script size budget is accepted, with the guard at 46 KB.
- The payment provider is decided later; Mollie is the recommendation.

## Decisions I made

### Setup and infrastructure

**1. Separate database login for background work.**
- **What:** background jobs and the super-admin console connect with their own login (`DATABASE_URL_SYSTEM`, role `cmp_system`) instead of switching roles on the app's connection.
- **Why:** if app code could switch roles, any bug could raise its own rights.
- **Cost if wrong:** one extra environment variable.

**2. Sign-in tables are not split per customer.**
- **What:** the sign-in library's tables (users, sessions, accounts, members, invitations and so on) are treated as identity tables. They have no per-customer database rule; the library's own checks guard them, and the cross-account sweep tests them.
- **What still has the rule:** every product table (entitlements, audit log reads, and every table from plan 2b on).
- **The one exception to the import rule:** the library gets its database handle from a single explicit export (`authDatabase`).
- **Cost if wrong:** those tables rely on the library plus the sweep.

**3. CI runs its own services.**
- **What:** CI (`.github/workflows/cmp.yml`) runs Postgres 17 and a Mailpit test mail server.
- **Cost if wrong:** CI config only.

**4. Docker Desktop.**
- **What:** I started it on your machine for the database and browser tests.
- **Cost if wrong:** nothing; local only.

**5. Broken library release left out of scope.**
- **What:** see open question 2.
- **Cost if wrong:** no library releases are published until it's fixed.

**6. Library CI always runs on pull requests.**
- **What:** removed `paths-ignore` from `ci.yml`, so a pull request that only touches `cmp/` can't hang waiting for a required library check.
- **Caveat:** I couldn't verify your branch-protection settings.
- **Cost if wrong:** a few extra CI minutes.

**7. Secrets and env files.**
- **What:**
  - Log redaction ignores letter case and covers `authorization`, `*token`, `apikey`, `secret`, `password`, `cookie` and `database_url`, at any depth.
  - Production refuses an `http://` `PUBLIC_ORIGIN`.
  - All `.env*` files are ignored except `.env.example`.
- **Cost if wrong:** a small change.

### Languages and pages

**8. Language in the address.**
- **What:**
  - An address without a prefix is always English; `/sk/...` is always Slovak.
  - There's no automatic redirect from the browser's language. The browser's language or a cookie only suggests a choice in the switcher.
  - The switcher is plain links handled by the server, so it works without JavaScript.
- **Cost if wrong:** a Slovak visitor sees English until they click once.

**9. Accessibility checks.**
- **What:** an axe check runs on every page the browser tests visit, from the first task.
- **Cost if wrong:** problems got fixed earlier than strictly needed.

**10. Stricter hard-coded-text check, and search basics.**
- **What:**
  - `check:words` also catches text in conditional JSX, in button values, in meta description/og content and in `set:text`.
  - Pages carry a canonical link.
  - The 404 page has no language alternates.
- **Cost if wrong:** a small change.

**11. `/sk` without the slash.**
- **What:** it answers 200 and names `/sk/` as the canonical address. There's no redirect and no adapter patch.
- **Cost if wrong:** two addresses for one page until plan 5 (public site) looks at it again.

**12. One domain per build.**
- **What:** the build needs `PUBLIC_ORIGIN`, because the prerendered pages contain absolute addresses. Dokploy builds on deploy, so this fits.
- **Cost if wrong:** changing the domain means a rebuild.

**13. Security headers fail loudly.**
- **What:**
  - The build fails if the adapter patch or the env transform didn't run.
  - The server refuses to start if prerendered pages exist but their CSP header map is empty.
- **Cost if wrong:** a small change.

### Database

**14. Customer filter rule.**
- **What:** the rule is `account_id = nullif(current_setting('app.account_id', true), '')::uuid`. A reused connection reads an empty value after a scoped transaction; this form returns zero rows where the plan's form would raise an error.
- **Cost if wrong:** nothing; it's equivalent but stricter.

**15. Database logins are created by a one-time admin script.**
- **What:** `db:init` creates the logins using `DATABASE_URL_ADMIN`. Schema updates (migrations) run as `cmp_owner` without superuser rights.
- **Cost if wrong:** one extra deploy step, which is documented.

**16. Database hardening.**
- **What:**
  - The audit log allows inserts only into specific columns.
  - The cross-account write test checks for the exact refusal.
  - A customer's database handle stops working once its scope ends.
  - The lint rule bans every Postgres and Drizzle driver outside the data layer.
- **Cost if wrong:** a small change.

**17. Mail queue hardening.**
- **What:**
  - Finished mail jobs keep no link tokens, and failed copies keep only the template, the language and the source id.
  - Malformed jobs are set aside and logged.
  - Invisible formatting characters are rejected.
  - The queue's database functions can't be run by everyone.
  - The worker shuts down cleanly, even when stopped during start-up.
  - A queue version mismatch is refused.
- **Cost if wrong:** a small change.

### Sign-in and limits

**18. Sign-in hardening.**
- **What:**
  - A per-account limit on failed sign-ins.
  - A clear "account locked" message.
  - The second-factor marker survives a password change.
  - Session renewal cookies are passed through.
  - A nightly cleanup of expired sessions, codes and old rate-limit rows (these hold visitors' addresses).
  - Tests use a local stand-in for the leaked-password check, not the live service.
- **Cost if wrong:** a larger fix round.

**19. How the failed-sign-in limit works.**
- **What:**
  - Only wrong passwords count.
  - The strict limit is per account and address.
  - A much higher account-wide cap is the backstop.
  - There's no lockout of a whole address.
- **Accepted risk:** a large botnet can still delay one account's sign-in. Passkeys are not affected.
- **Cost if wrong:** slow guessing spread over many machines has more room.

**20. The visitor's real address comes from the network connection.**
- **What:**
  - The patched server adapter puts the connection's address in an internal header, after deleting any copy the visitor sent. A dev-server middleware does the same.
  - The address is only trusted from `TRUSTED_PROXIES`.
  - IPv6 is grouped by /64 for every per-address limit.
  - The failed-password counters check and increase in one step.
- **Cost if wrong:** one more fix round.

**21. Account-wide cap of 200 failed passwords an hour.**
- **What:** the per-address limit is 4 per 15 minutes, so at most 16 an hour from one address. Blocking one account therefore takes about 13 addresses (or IPv6 /64 networks) an hour.
- **Cost if wrong:** up to 200 guesses an hour against one account.

**22. Growth limits.**
- **What:**
  - 10 accounts created per person.
  - 50 open invitations per account.
  - 50 invitations a day per account, and 100 a day per person.
  - Refusals are translated and logged in the audit log.
- **Cost if wrong:** the numbers get tuned later.

### Accounts, invitations and the super-admin console

**23. Invitation details.**
- **What:**
  - A wrong email gets 404 with a reason code, never 403.
  - Expiry follows the database clock.
  - Unused sign-in library settings are removed.
  - Sign-up and sign-in links on the invitation page bring the person back to the invitation.
- **Cost if wrong:** a small change.

**24. Read-only account viewing ("impersonation").**
- **What:**
  - Viewing uses its own server-only step. The sign-in library's admin role and ban features are removed, so no database value can ever grant admin rights.
  - A timed-out view is logged and restores your own session.
  - Stopping a view is logged before the switch.
  - The console's reads are logged against the viewed account.
- **Cost if wrong:** one larger fix round.

**25. Viewing details.**
- **What:**
  - Each view's cookie is tied to that one view and works once, so each view's end is logged exactly once.
  - Views a member revokes are logged as revoked.
  - Members see "support view" in their session list, not your user id or browser.
- **Cost if wrong:** a small change.

### Deployment

**26. Deployment hardening.**
- **What:**
  - Backups run as a dedicated read-only login, not the superuser.
  - The restore test runs off the server, so the private key never sits on it.
  - No password appears on a command line.
  - The compose file and docs use Dokploy's project name and a separate image name per app.
  - The guide's forged-header check really tests it.
  - Invitation "not found" and "wrong email" give identical answers.
  - There are extra regression and accessibility tests.
- **Cost if wrong:** one larger fix round.

**27. Final fix wave**, after the whole-branch review.
- **What:**
  - Request bodies have a size limit. Before this, one large POST could crash the 512 MB container.
  - Names are checked at sign-up and on profile changes. Before this, a bad name broke invitations for that person forever.
  - The audit viewer has paging and is no longer flooded by its own access rows.
  - Account creation is limited to 10 an hour per person and per address.
  - A stale viewing cookie is expired.
  - Email needs an encrypted connection in production, except to local hosts.
  - Password changes and resets, passkey changes and two-factor changes go into the audit log.
  - Accounts without a paid plan can't send invitations.
  - CI builds the backup image.
  - The backup password reaches `pg_dump` via the environment.
  - The guide explains that the whole Dokploy network is trusted as a proxy, and that pointing `TRUSTED_PROXIES` at Traefik's address is better.
  - Rate-limit rows are kept for 2 hours.
- **Cost if wrong:** a bigger fix wave.

## Left for later (known, accepted for now)

Some of these may have been fixed by a later round; check before acting on one.

**Security and privacy**
- Session tokens are stored in plain form; the sign-in library has no hashing option.
- Accounts can't be deleted yet, because the audit log refers to them. The entitlements link has no delete rule either.
- Backup codes can't be regenerated from the Security page.
- `pg_hba` doesn't restrict the backup login to the backup container.
- Base images are pinned by tag, not by digest.

**Correctness and operations**
- Accounts made before migration 0007 have no recorded creator; this could be backfilled from the audit log.
- A correct sign-in doesn't reset the per-address failure count.
- The worker has no liveness check. Mail throughput (about 30 queued mails take over 5 seconds) is worth checking against real volume.
- Two log-noise issues:
  - A visitor who disconnects mid-upload logs a "Could not render" error with a stack.
  - A lost viewing cookie can repeat a failing audit insert.
- Each single-account audit view writes its own row into that account's log.
- Astro's origin check compares against the internal address behind the proxy. The no-Origin refusal will need an allowlist for payment webhooks (plan 4).

**Tests and tooling**
- The catalog check doesn't compare `{variables}` between languages.
- On Windows, tests need an uppercase `D:` path, and the backup tests need Git Bash. CI on Linux is unaffected.

## Verification at the end of plan 2a

Run from my own final pass:
- Library: 882/882 tests.
- App: type check, lint and `check:words` clean; 397 unit, 268 database (plus 2 Linux-only skipped) and 134 browser tests.
- The final review and the fix-wave re-review left no Critical or Important findings open.
