# cloveconsent

A small consent-management package for Clovetek sites: a typed, validated configuration of the services a site uses, a cookie banner (built on `vanilla-cookieconsent`), consent-gated embeds and scripts, Astro components, and an optional consent logger. It supplies facts (what a service stores, who the provider is, which origins it uses). It never supplies legal wording or a legal basis.

```sh
npm install github:KaktusBR/CloveConsent#vX.Y.Z
# in CI and on deploy, always install with scripts disabled:
npm ci --ignore-scripts
```

Tags carry the built `dist/`; `main` does not. Install from a tag, never from `main`.

## Minimal Astro example

`src/consent.config.ts`:

```ts
import { defineConsent } from 'cloveconsent'
import { cloudflareCdn, theme, turnstile, youtube } from 'cloveconsent/catalog'

export default defineConsent({
  locales: ['sk', 'en'],
  defaultLocale: 'sk',
  revision: 1,
  privacyHref: '/ochrana-udajov/',
  cookieName: 'cc_mysite', // see "Local development"
  services: [turnstile(), theme(), youtube()],
  processors: [cloudflareCdn()],
})
```

A page or layout:

```astro
---
import config from '../consent.config'
import ConsentBanner from 'cloveconsent/astro/ConsentBanner.astro'
import ConsentPreferences from 'cloveconsent/astro/ConsentPreferences.astro'
import GatedEmbed from 'cloveconsent/astro/GatedEmbed.astro'
import ConsentReopen from 'cloveconsent/astro/ConsentReopen.astro'
import ProcessorList from 'cloveconsent/astro/ProcessorList.astro'
---
<ConsentBanner config={config} locale="sk" />
<GatedEmbed config={config} locale="sk" serviceId="youtube"
  src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" />
<ConsentReopen config={config} locale="sk" />
<!-- on your privacy page: -->
<ConsentPreferences config={config} locale="sk" />
<ProcessorList config={config} locale="sk" />
```

`GatedEmbed` throws at build time if `src` is not https on an origin allowed by the service entry.

### Subscribing to consent events

Config hooks (`hooks.onConsent` etc.) are functions and cannot be serialised into the page, so they do not run in Astro. Read the current decision and subscribe at runtime instead.

The page-load `consent` event fires while the banner boots, which is before `DOMContentLoaded`, so a listener added at `DOMContentLoaded` never sees it. Read the stored decision with `getState()` first, then subscribe for later events:

```ts
import { getConsent } from 'cloveconsent'

const start = () => {
  const consent = getConsent()
  if (!consent) return // banner not booted (e.g. invalid config)
  const now = consent.getState() // ConsentState | null: the decision this page loaded with
  /* ... use `now`, and gate on consent.isAllowed(id) ... */
  consent.on('consent', (state) => { /* a decision took effect later on this page */ })
  consent.on('change', (changedCategories) => { /* ... */ })
}
if (getConsent()) start()
else document.addEventListener('DOMContentLoaded', start, { once: true })
```

Caution: `consent` fires on every page load that has a stored decision, together with `first-consent` on a first decision, and again when a visitor re-confirms a re-consent banner without changing categories. Do not use it to write server-side records: log on `first-consent` and `change` only (see "Optional consent logging").

Astro runs the banner's module script before `DOMContentLoaded` fires, so `start` finds `getConsent()` set. If you boot the banner yourself, use the return value of `bootFromDom()` (a `Consent`, or `null` if the config is invalid) instead:

```ts
import { bootFromDom } from 'cloveconsent'

bootFromDom()?.on('change', (changedCategories) => { /* ... */ })
```

Events: `first-consent`, `consent`, `change` (argument: the changed categories), `once` (argument: the service id). `on()` returns an unsubscribe function.

### Optional consent logging

`createConsentLogger` returns an async function that POSTs the consent id, revisions and the per-category decision to your endpoint. The endpoint must be a same-origin path or an https URL.

```ts
import { createConsentLogger, getConsent } from 'cloveconsent'

const log = createConsentLogger({ endpoint: '/api/consent-log', siteSlug: 'mysite' })

const wire = () => {
  const consent = getConsent() // null until the banner has booted
  if (!consent) return
  const send = () => void log(consent.getState(), consent.config)
  consent.on('first-consent', send)
  consent.on('change', send) // its argument is the changed categories, so read the state instead
}
if (getConsent()) wire()
else document.addEventListener('DOMContentLoaded', wire, { once: true })
```

Do **not** subscribe to `consent` (or `config.hooks.onConsent`) to write a server-side record: it fires on every page load with a stored decision, and again together with `first-consent` on a first decision. Use `first-consent` plus `change`.

Astro view transitions may not re-run the banner script on client-side navigations (not verified here); test your setup if you use them.

### Withdrawal, one-time allowances and leftovers

- After a visitor withdraws consent for a **script-type** service, the already-executed script's side effects (globals, timers, a tracker rewriting cookies) cannot be undone. For such services, recommend a page reload after withdrawal. Storage the client could not clear is reported in `consent.leftovers`.
- `allowOnce(id)` on a script-type service does **not** load the script until the next consent event. Embeds (iframes) load immediately.
- A persisted decision (accept, reject or change) supersedes one-time allowances.

## Legal review needed

> - Putting `theme` (or any theme/branch choice) in `functional` rather than `necessary` is a **legal call** that the code does not make for you. Decide it with your adviser.
> - The `fr` and `de` texts are **unreviewed drafts** (catalog entries are flagged `unreviewed`).
> - The package supplies **facts**, never legal wording or a legal basis. Your privacy notice and its wording remain your responsibility.
> - Catalog entries carry `lastVerified` only where the provider's own documentation backed every fact (see `docs/catalog-verification.md`). Turnstile, YouTube, Facebook Graph and `hosting()` are still `null`: treat them as unverified, and note that an empty `storage` on an unverified client entry means unknown, not none.
> - The catalog `theme` entry assumes the site stores the choice in `localStorage` under the key `theme` (verified for blindman.sk only). If yours differs, the entry is wrong for your site.

## Security notes

- No raw HTML: service titles, descriptions and notes are rendered as text, never as markup.
- Origin allowlists: an embed or script `src` must be https, must not contain credentials, and its host must be in the service's `origins`. Anything else is refused.
- CSP helper: `cspSources(config)` returns sorted host lists for `script-src`, `frame-src`, `connect-src` and `img-src`, derived from the selected client services. Merge them into your policy:

  ```ts
  import { cspSources } from 'cloveconsent'
  import config from './consent.config'

  const csp = cspSources(config) // { 'script-src': [...], 'frame-src': [...], ... }
  ```

- Cookie flags: the consent cookie is `Path=/; SameSite=Lax`, lives 182 days, and is `Secure` when the page is served over https.
- `window.CookieConsent` is frozen and exposes only `acceptAll()`, `rejectAll()` and `getState()`.
- The logger refuses non-https endpoints (except http between localhost addresses), credentials in the URL and cross-origin paths, and sends no cookies (`credentials: 'omit'`).
- Install with `npm ci --ignore-scripts`; CI also runs `npm audit --omit=dev --audit-level=high`.

## Local development

- `Secure` is only set on https, so the cookie works on `http://localhost`.
- Local sites on different ports share the `localhost` cookie jar (cookies ignore ports). Give each site its own `cookieName` (`^[A-Za-z0-9_-]{1,64}$`) so they do not overwrite each other's decision.
- Cloudflare Turnstile on localhost needs `localhost` in the widget's allowed hostnames, or Cloudflare's test keys.

## Local admin

`npm run admin` starts a local, view-only dev tool at http://localhost:4321. It reads `src/` directly, so edits to the catalog or language packs show up on reload. It is not part of the published package and never writes to the repo; all changes to defaults are made in code.

- **Catalog**: every service and processor with category, storage, gating, origins and `lastVerified` (unverified entries are flagged). Expand a row for the full entry and its `notes`.
- **Languages**: every banner and catalog text against each language pack, with missing translations and unreviewed packs highlighted.
- **Playground**: pick languages, services, processors and options and see the real banner and preferences panel, with the same validation errors a site build would give.

## Adding a catalog entry

1. Add a file under `src/catalog/` that returns a `ClientEntry` or `FirstPartyEntry` (see `youtube.ts`, `theme.ts`) and export it from `src/catalog/index.ts`.
2. Provide every localised field in all four locales (`sk`, `en`, `fr`, `de`) with the `L(sk, en, fr, de)` helper; keep `fr`/`de` flagged `unreviewed` until reviewed.
3. Leave `lastVerified: null` until you have checked the provider's own documentation, then set it to that date.
4. Start `catalogRevision` at 1 and bump it whenever anything the visitor was told changes (storage, purpose, provider, expiry). Bump the site's `revision` in `defineConsent` too, so visitors are asked again.

## Releasing

### Automatic (normal path)

Every push to `main` (that is, every merged pull request) runs the `release` workflow. It takes the highest `vX.Y.Z` tag, bumps the minor (`v1.4.0` becomes `v1.5.0`; the first release is `v1.0.0`), builds, tests, checks the tag in a fresh clone and pushes the tag. Merges that only change `docs/` or top-level `*.md` files are skipped. Only the tag carries `dist/`; `main` never does.

In a consuming repo, track the latest release with a range and update when you want it:

```sh
npm install github:KaktusBR/CloveConsent#semver:^1.0.0
npm update cloveconsent
```

Because every merge is a minor bump, versions cannot signal a breaking change: read the merged PR before updating a production site, and rely on the lockfile.

For this to be safe, turn on branch protection for `main` in the GitHub repo settings (require a pull request and the `ci` check before merging). The release workflow has write access to push tags, so anything that reaches `main` is published.

### Manual (fallback)

From a clean `main`:

```sh
node scripts/release.mjs 1.0.0
git push origin v1.0.0
```

The script checks the tree, branch and tag, runs install, typecheck, tests, Astro tests and build, then creates a release commit containing `dist/` and a `package.json` without `"private"` and with the new version. That commit exists only on the tag; `main` never contains `dist/`. The script never pushes, so pushing is a manual step. On a tag push, the `verify-release` workflow rebuilds and checks that the committed `dist/` matches the source.
