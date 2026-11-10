# Hosted CMP (phase 2): design

Date: 2026-11-10. Status: draft for approval. Follows `2026-11-09-consent-manager-core-design.md` (phase 1, built and merged).

## Intent

A paid SaaS at cmp.clovetek.com where site owners (the author's clients and other companies) manage cookie consent for their websites without touching code beyond pasting two snippets. Think Cookiebot's admin without the clutter: one clear screen per job. The visitor-facing banner and settings panel are the phase 1 library (cloveconsent); this product hosts its configuration per site, delivers it, proves consent, and checks that blocking really works.

The author has been burned before by a cookie banner that did not actually block anything. Blocking that is verifiably correct is the core promise of the product, above everything else.

## Goals

1. **Paid access.** A customer pays, then gets an account. Billing sits behind a provider interface; the provider (Mollie, Paddle or another) is decided later. Until then a super-admin can mark an account as paid by hand. Besides the subscription there is a one-time purchase that produces a finished, self-hosted package for one site (see Billing), built in the billing milestone.
2. **Sites.** A customer adds sites (domains), each with its own configuration: services, categories in use, texts per language, languages, appearance (phase 1 `ui` settings: layout, positions, colors, manager options), policy version, privacy link. Nothing is baked in: every look and behavior is a setting with a default.
3. **Two embed snippets per site.**
   - Banner snippet, first in `<head>`: shows the banner, blocks everything optional until consent, records decisions.
   - Management snippet: a placeholder element placed on the site's GDPR or cookie page, which renders the full settings panel inline (citywash.sk/gdpr is the reference for placement and feel), with per-service toggles, the consent reference, saved date and Withdraw.
4. **Blocking that blocks.** Before consent nothing optional runs, loads or sends a request. See Blocking.
5. **Blocked visual elements explain themselves.** Every blocked visual element (YouTube, maps, social embeds, script-drawn widgets) shows a message in its place, sized like the element, saying it is blocked because of the visitor's choice, with "Allow <service>" and "Load once" and a link to settings. Never blank space.
6. **Scanner.** Scans a site in a real browser, detects cookies, storage and third-party requests, matches them to the catalog, suggests the configuration, flags unknowns, and runs the blocking check (below), on demand and on a schedule.
7. **Consent records.** Every decision is stored per site with its consent reference, so the customer can prove consent; searchable by reference, exportable.
8. **Multilingual from the start, any language.** English is the primary (source) language. No user-facing words live in source files: every string of the admin, the public site, emails and the runtime comes from message catalogs keyed by id, so adding a language is adding translation files (Astro i18n routing for URLs, a typed message-catalog library for strings; the builder picks the library). Banners, panels and placeholders can be enabled in any language per site: the shipped packs (en, sk, fr, de) are used where they exist, and a translation editor lets the customer fill in every text for any other language, pre-filled from English with missing texts clearly marked; publishing refuses while anything is missing (the phase 1 strict rule). Customers can override any text in any language.
9. **Public site** at cmp.clovetek.com: marketing, pricing, docs, legal pages; fully static; excellent SEO, AEO and GEO; multilingual.

## Non-goals (for this design)

- Choosing the payment provider (an adapter is added later).
- IAB TCF, Google Consent Mode v2 signals (worth a later design; keep the runtime able to add them).
- A WordPress plugin or other CMS integrations (the snippets work everywhere).
- A mobile app SDK.

## Anti-goals (failures even if it technically works)

- Anything optional loading or setting storage before consent, or after it was refused or withdrawn.
- A blocked element that leaves an empty gap or a broken box.
- Cookiebot-style clutter: deep menus, upsell noise, settings nobody understands.
- One tenant able to see or affect another tenant's data, through any path.
- A visitor's page made slow by the CMP (no blocking network round trip to a database on page load).
- Shortcuts: anything "good enough for now" in security, privacy, accessibility or correctness.

## Decided by the author

- Hosting on the author's Dokploy server (Docker). Data in the EU.
- Astro preferred; Next.js only if Astro cannot do the job. What does not need to be dynamic is static.
- Tailwind CSS, shadcn, React; neat, reusable components; no duplication.
- Multilingual app and multilingual banners from the start.
- Public site: SEO, AEO, GEO, Open Graph, security headers. Security of the app is top priority.
- Payment provider decided later; must be well known, strong, with a good API. Prepare an interface.
- Build order: (1) accounts, sites, config editor, publishing, embed scripts, consent records; (2) scanner and blocking check; (3) billing behind the provider interface; (4) public site.
- Never take shortcuts; always the best approach.

## Architecture (my calls, open to change)

- **Repository:** a new repository for the product (working name `cmp.clovetek.com`), depending on the cloveconsent library. Library changes needed by the product go to the cloveconsent repo through its own review, never as forks inside the product.
- **App:** one Astro app (Node adapter, `output: 'server'` with per-page `prerender`) serving the public site (prerendered, static) and the admin (server-rendered, React islands for interactive screens, shadcn components). Astro is enough here: the admin is forms, tables, previews and dashboards, all fine as islands; API routes are Astro endpoints.
- **Database:** Postgres with Drizzle (typed schema, migrations in the repo).
- **Auth:** a self-hosted, maintained auth library (e.g. Better Auth) with email and password plus email verification, mandatory-available TOTP 2FA, passkeys if the library supports them well, session cookies (HttpOnly, Secure, SameSite=Lax), no third-party identity provider in the default setup.
- **Jobs:** a Postgres-backed queue (e.g. pg-boss) for scans, publishing, scheduled checks, exports and emails. No Redis needed.
- **Scanner:** a separate container running a headless browser (Playwright, Chromium), pulling jobs from the queue, with strict egress rules (see Security).
- **Delivery of runtime files:** on publish, the app builds per-site static files (the banner script with the site's config and language texts inlined, versioned and immutable) and writes them to storage served by a static file server (or a CDN in front, EU-based, later). A tiny per-site loader URL points to the current version with a short cache lifetime. Visitors never hit the database on page load.
- **Consent record ingestion:** a small endpoint that accepts decision records from visitors' browsers (sendBeacon/fetch), validates them strictly, rate-limits per site and per client, and writes to Postgres through the queue or directly with backpressure.
- **Email:** transactional email through an EU provider or the author's SMTP (left to the builder), templates translated.
- **Observability:** structured logs, health and readiness endpoints, error tracking self-hosted or EU-based, daily encrypted Postgres backups with a tested restore.

## Tenancy and roles

- A user (login) can belong to several accounts and switch between them, for agencies and freelancers (my call).
- **Account** (the paying customer, one subscription or one-time purchases) has **members** with roles: owner, admin, editor (edit sites, cannot manage billing or members), viewer (read-only, sees records). Invitations by email.
- **Super-admin** (the author): sees accounts, can mark an account paid, suspend, impersonate read-only with an audit trail, manage the shared catalog overlay and placeholder texts.
- Tenant isolation is enforced in one data-access layer: every query takes the account scope and cannot run without it; a dedicated test suite tries cross-tenant access through every route.

## Sites and configuration

- A **site** has a name, one or more verified domains, default language, enabled languages, services (from the catalog or custom), processors, texts and overrides per language, `ui` settings, policy version, privacy link, cookie name.
- **Custom services:** customers can add a service the catalog does not have (name, provider, privacy URL, category, hosts, storage items, gating, texts); the same validation as the library applies.
- **Domain verification:** DNS TXT record or a file at a well-known path. The runtime only works on verified domains (the loader checks `location.hostname`; records from other origins are rejected).
- **Drafts and publishing:** edits go into a draft; Publish validates the full config through the library (`defineConsent`, strict translations), builds the runtime files, and makes them live. Every published version is kept; rollback is one click. Publishing a change that affects consent (new service, changed purpose) asks whether to bump the policy version, which re-asks visitors (phase 1 behavior).
- **Live preview** in the editor renders the real banner and panel with the site's settings and colors, in each language, light and dark.

## Runtime on customer sites

- **Banner snippet:** one synchronous, parser-blocking `<script src>` placed first in `<head>`; it must execute before any other script so it can block. Its URL is stable per site and always serves the current published version (short cache lifetime with ETag revalidation), so publishing and rollback go live without re-pasting the snippet (my call: no SRI hash, which would force a re-paste after every publish; a loader that inserts a versioned script is rejected because inserted scripts do not block the parser).
- **Runtime from the library:** the standalone browser bundle, auto-blocking and widget placeholders are built in the cloveconsent library first, through its own review and release (published so the product can pin a version); phase 1 Astro sites get them too (my call).
- **Unconfigured known trackers:** a catalog service the site has not configured is still blocked by auto-blocking, and the runtime reports it so the admin shows "blocked, not configured: add it or remove the tag" (my call; loading it would break the core promise).
- **Domains:** each domain is verified separately; verifying an apex lets the customer add its subdomains. Consent is per host by default, with an optional setting to share it across subdomains (cookie `Domain` attribute) (my call).
- **Compatibility:** sites that already use the phase 1 library keep their visitors' consent (same cookie format and consent reference); a test pins this (my call).
- **Management snippet:** `<div data-cloveconsent-settings></div>`; the banner script renders the phase 1 panel into it. Optional processors list element.
- **Consent cookie** is first-party on the customer's domain (set by the script), as in phase 1. Records go to the CMP endpoint with the consent reference, site, policy version, language, decision kind, accepted services and timestamp. No IP address is stored; the user agent is reduced to browser family and version (my call, data minimization).
- **Size and speed budgets:** the banner script stays small (target under 30 KB gzipped including config for a typical site; the builder sets the exact budget and a CI check). The consent cookie must stay within 4096 bytes: the publish step rejects or warns on configs that could exceed it (deferred phase 1 item).

## Blocking

Three layers, all required:

1. **Marked tags (prior blocking, the reliable layer).** Third-party scripts in the customer's HTML are written as `<script type="text/plain" data-consent="<service-id>" ...>`; iframes as `<iframe data-consent-src="..." data-consent="<service-id>">` (no `src` until allowed). The browser cannot execute or load these. The admin generates the exact markup for each configured service and shows install instructions per platform.
2. **Auto-blocking (safety net).** The banner script, running first, intercepts scripts and iframes added after it (parser-inserted and dynamically inserted, including via `document.createElement` and DOM insertion APIs) whose source matches a configured or catalog service host, and neutralizes them before they run, restoring them on consent. Anything it cannot guarantee (for example tags placed above the snippet, or inline scripts that call third parties) is reported by the scanner rather than assumed.
3. **Blocking check (proof).** The scanner loads the live site in a real browser: (a) with no consent, (b) after Reject all, (c) after Accept all; on several pages. In (a) and (b) any cookie, storage item or network request belonging to a non-necessary service, or to an unknown third party, is a failure with details (which page, which request, which tag likely caused it, how to fix). The site overview shows the result plainly (pass, or fail with a list). Runs after each publish, on demand, and on a schedule; failures email the customer.

Withdrawal and per-service changes follow phase 1: scripts are unloaded where possible, storage the site can clear is cleared, leftovers the browser keeps are reported to the visitor.

## Placeholders for blocked visual elements

- Blocked iframes (YouTube, Vimeo, Google Maps, Spotify, social embeds, any iframe service) are replaced by a placeholder that keeps the element's size and aspect ratio (from attributes, inline style or computed size), shows the service name and the reason ("YouTube is turned off because of your cookie choice. Turn on media cookies to watch."), and offers "Allow <service>", "Load once" and a settings link. Allowing loads it immediately without reload; withdrawing replaces it again.
- Script-drawn widgets: the customer marks the spot with `<div data-consent-placeholder="<service-id>">`; the same message shows there until consent, then the widget's script runs.
- All placeholder texts are per-language, editable per site, translated in the packs.
- The blocking check flags blocked visual elements that render without a placeholder.

## Scanner

- Input: a site's verified domains; starts from the home page and the sitemap, follows internal links up to a page limit (builder sets limits per plan).
- Records per page and consent state: cookies (name, domain, expiry, flags), localStorage/sessionStorage keys, network requests by host, scripts and iframes and their sources, and where in the page they came from.
- Matching: by host, script URL and cookie/storage name against the catalog and the site's custom services. Output: detected known services with one-click "add to site", unknown hosts and cookies flagged for the customer to classify (becoming custom services), and the blocking check results.
- Scheduled re-scans detect drift (new tracker, removed service) and notify.
- Results are stored per scan, comparable with the previous scan.

## Consent records

- Searchable by consent reference, date range, decision kind; detail view shows exactly what was accepted under which policy version and language.
- Export (CSV and JSON) for a date range or a reference; deletion on request for a reference (data subject requests).
- Retention per site, default 3 years (my call; the customer can change it within legal bounds the builder documents); old records are deleted by a scheduled job.

## Billing (provider decided later)

- A `BillingProvider` interface: start checkout for a plan, handle provider webhooks (verified signatures, idempotent), cancel, change plan, open or render the customer's billing view (plan, payment method, invoices, cancel). The rest of the app reads only the account's entitlement (paid until, plan limits).
- A manual provider used by the super-admin until a real one is chosen.
- **Account states and grace period (decided):** when payment fails, the subscription ends or the account is suspended, the last published runtime keeps working and consent records keep being stored for 30 days, with emails to the customer. After that the runtime keeps working in "necessary only" mode: the site stays compliant and nothing optional runs; the banner is never removed (removing it would leave marked tags blocked forever with no way to allow them). Consent records are never dropped; over a volume limit they are still stored and the customer is asked to upgrade.

### One-time purchase: self-hosted export (decided by the author: offer it; details are my calls)

Besides the subscription, a one-time payment buys a finished, self-hosted package for one site:

- The customer configures the site in the same editor (services, texts in all chosen languages, appearance) during a setup window (my call: 30 days from purchase), may run the scanner and blocking check during that window, then clicks **Finalize and download**.
- Finalizing runs full validation (strict translations, cookie-size check) and produces a downloadable zip: the self-contained runtime script with the config and texts inlined, the management element markup, the marked-tag markup for each configured service, the CSP host lists, a placeholder stylesheet if needed, and an install guide in the customer's language.
- After finalizing, the site is read-only in the app; changing it means a new purchase (or upgrading to a subscription, which imports the finalized config).
- The exported runtime does not call cmp.clovetek.com: no hosted consent records, scans or updates. It exposes the `onDecision` hook and an optional setting to POST records to the customer's own URL, documented in the guide.
- The download stays available in the account for re-download.
- Licensing terms for the exported files (use on the purchased domain(s), no resale) are written into the terms; the runtime itself stays the MIT library.
- Plans and their limits (sites, languages, scans per month, consent records volume, team members) are data, not code.
- Invoices and VAT depend on the provider choice (merchant of record or not) and are designed when the provider is chosen.

## Admin UI

Straightforward, few screens, each doing one job:

- **Sites list:** name, domains, blocking check status, last publish, records in the last 30 days.
- **Site:** Overview (status, blocking check, install snippets with copy), Services (configured, scan suggestions, add from catalog or custom), Texts and languages, Appearance (layout, colors, manager options, live preview), Records, Versions (history, diff, rollback), Settings (domains and verification, policy version, cookie name, retention).
- **Scans:** history and details per site.
- **Account:** members and roles, billing, security (2FA, sessions), audit log.
- **Super-admin:** accounts, manual payment status, catalog overlay, system health.
- Accessible (WCAG 2.2 AA), keyboard-first, works on mobile, light and dark, translated.

## Public site

- Pages: home, features, pricing, docs (install, blocking, placeholders, API for records export), legal (privacy policy, terms, DPA, sub-processors, cookie policy using the product itself), contact. Blog optional later.
- Static, prerendered, per-language URLs with hreflang, canonical URLs, sitemap, robots.txt, `llms.txt`, JSON-LD (Organization, SoftwareApplication, Product with Offers, FAQPage, BreadcrumbList), Open Graph and Twitter cards with generated images, fast (Core Web Vitals green), accessible.
- AEO/GEO: content structured as clear questions and answers, concise definitions, comparison and how-to pages that AI answer engines can quote accurately.

## Security (top priority)

- Strict CSP with nonces or hashes, no `unsafe-inline` or `unsafe-eval`; HSTS with preload; X-Content-Type-Options, Referrer-Policy, Permissions-Policy, frame-ancestors; COOP/CORP where applicable. The runtime files served to customer sites have their own appropriate headers (CORS for the record endpoint limited to verified domains).
- CSRF protection on all state-changing requests; input validation at every boundary (zod or equivalent shared with the library's validators); output escaping by default.
- Rate limiting on auth, record ingestion and scans; account lockout and breach-aware password checks.
- Scanner isolation: separate container, no access to the app database or internal network, egress allowed only to public internet addresses (block private, loopback, link-local and metadata ranges, re-checked after DNS resolution and redirects to prevent SSRF and DNS rebinding), resource and time limits per scan.
- Secrets in environment or Dokploy secrets, never in the repo; dependency scanning and pinned versions; least-privilege containers (non-root, read-only filesystem where possible).
- Audit log of sensitive actions (members, billing, publishing, exports, super-admin actions).
- Backups encrypted; GDPR: the CMP acts as processor for customers' visitor data; DPA, sub-processor list, data export and account deletion.

## Testing

Unit tests, integration tests against a real Postgres, end-to-end tests with Playwright covering the main flows (sign-up to live banner, publish, scan, records), a tenant-isolation suite, security tests (headers, CSP, CSRF, SSRF guards), accessibility checks (axe) on admin and public pages, visual checks of banner and placeholders, and a blocking-check test site with known trackers that must be caught.

## Left to the builder

Exact libraries where the design names an example, table layouts, URL structure, component breakdown, queue job names, file storage layout, limits per plan, email provider, the precise auto-blocking interception technique (as long as it meets the Blocking section), and the deployment layout on Dokploy.

## Not legal advice

Wording of legal pages and defaults (retention, texts) must be reviewed by a lawyer before launch.
