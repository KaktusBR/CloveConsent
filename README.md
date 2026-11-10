# cloveconsent

A small consent-management package for Clovetek sites: a typed, validated configuration of the services a site uses, a cookie banner (built on `vanilla-cookieconsent`), per-service consent with a settings panel for your privacy page, consent-gated embeds and scripts, Astro components styled from your Tailwind colour tokens, and an optional consent logger. It supplies facts (what a service stores, who the provider is, which origins it uses). It never supplies legal wording or a legal basis, and nothing here is legal advice.

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
import ConsentSettings from 'cloveconsent/astro/ConsentSettings.astro'
import GatedEmbed from 'cloveconsent/astro/GatedEmbed.astro'
import ConsentReopen from 'cloveconsent/astro/ConsentReopen.astro'
import ProcessorList from 'cloveconsent/astro/ProcessorList.astro'
---
<ConsentBanner config={config} locale="sk" />
<GatedEmbed config={config} locale="sk" serviceId="youtube"
  src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" />
<ConsentReopen config={config} locale="sk" />
<!-- on your privacy page: -->
<ConsentSettings config={config} locale="sk" />
<ProcessorList config={config} locale="sk" />
```

Keep `ConsentBanner` on every page: it starts the client that the settings panel and the embeds use. See "Consent manager" for the settings panel, "UI settings" and "Colours and theme" for how to configure and style it.

`GatedEmbed` throws at build time if `src` is not https on an origin allowed by the service entry.

### Subscribing to consent events

Config hooks (`hooks.onReady`, `hooks.onDecision`) are functions and cannot be serialised into the page, so they do not run in Astro. Read the current decision and subscribe at runtime instead.

The page-load `ready` event fires while the banner boots, which is before `DOMContentLoaded`, so a listener added at `DOMContentLoaded` never sees it. Read the stored decision with `getState()` first, then subscribe for later events:

```ts
import { getConsent } from 'cloveconsent'

const start = () => {
  const consent = getConsent()
  if (!consent) return // banner not booted (e.g. invalid config)
  const now = consent.getState() // ConsentState | null: the decision this page loaded with
  /* ... use `now`, and gate on consent.isAllowed(id) ... */
  consent.on('decision', (info) => { /* the visitor made a decision on this page, see "Consent reference and record" */ })
}
if (getConsent()) start()
else document.addEventListener('DOMContentLoaded', start, { once: true })
```

Astro runs the banner's module script before `DOMContentLoaded` fires, so `start` finds `getConsent()` set. If you boot the banner yourself, use the return value of `bootFromDom()` (a `Consent`, or `null` if the config is invalid) instead:

```ts
import { bootFromDom } from 'cloveconsent'

bootFromDom()?.on('decision', (info) => { /* ... */ })
```

Events (`consent.on(event, fn)` returns an unsubscribe function):

| Event | Fires | Argument |
| --- | --- | --- |
| `ready` | on every page load that has a stored decision, and after each decision | `ConsentState \| null` |
| `decision` | exactly once per decision the visitor makes | `DecisionInfo` |
| `once` | when `allowOnce(id)` allows an embed for this page view | the service id |

Caution: `ready` fires on every page load, so do not use it (or `hooks.onReady`) to write server-side records. Use `decision`.

### Consent reference and record

Every stored decision carries a consent reference, `state.consentId`, plus the policy version (`siteRevision`, `revisions`), the time (`timestamp`) and the accepted services (`services`, by category). The visitor sees it in the settings panel (see "Consent manager") and can copy it, so you can find their record when they ask. The `decision` event and `hooks.onDecision(state, info)` give you everything a consent record needs:

```ts
consent.on('decision', (info) => {
  const state = consent.getState()
  if (!state) return
  void fetch('/api/consent-record', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reference: state.consentId,
      time: state.timestamp,
      policyRevision: state.siteRevision,
      kind: info.kind,
      language: info.locale,
      changedServices: info.changedServices,
      accepted: state.services, // category id -> accepted service ids (null for a cookie from before per-service consent)
    }),
  })
})
```

`DecisionInfo`:

| Field | Meaning |
| --- | --- |
| `kind` | `first`: the first answer ever. `change`: categories or services changed. `reconfirm`: the visitor re-confirmed after a re-consent prompt without changing anything. `withdraw`: the visitor withdrew all consent (`consent.withdraw()`). |
| `changed` | Optional categories whose acceptance changed (for `first`: the categories accepted). |
| `changedServices` | Service ids whose acceptance changed (turned on or off). For `first`: the services accepted. For `withdraw`: every service that was accepted before the withdrawal. |
| `locale` | The language the visitor saw the banner in. |

Reference, time and policy version come from the `ConsentState`, not from `DecisionInfo`. The record is stored by you, on your server; the library only reports it.

### Optional consent logging

`createConsentLogger` returns an async function `log(state, config, info?)` that POSTs one consent record to your endpoint:

| Field | Meaning |
| --- | --- |
| `siteSlug` | the `siteSlug` option, when set |
| `consentId`, `siteRevision`, `revisions`, `timestamp` | from the `ConsentState` |
| `categories` | category id -> `true` when the category is accepted at all. A category can be accepted for only some of its services, so read `services` for what consent was given for |
| `services` | ids of the optional services the stored choice accepts |
| `kind`, `changed`, `changedServices`, `locale` | from the `DecisionInfo`, when you pass it as `info`. Without it a withdrawal cannot be told apart from a refusal |

The endpoint must be a same-origin path or an https URL.

```ts
import { createConsentLogger, getConsent } from 'cloveconsent'

const log = createConsentLogger({ endpoint: '/api/consent-log', siteSlug: 'mysite' })

const wire = () => {
  const consent = getConsent() // null until the banner has booted
  if (!consent) return
  consent.on('decision', (info) => void log(consent.getState(), consent.config, info))
}
if (getConsent()) wire()
else document.addEventListener('DOMContentLoaded', wire, { once: true })
```

Do **not** subscribe to `ready` (or `config.hooks.onReady`) to write a server-side record: it fires on every page load with a stored decision. Use `decision`.

Astro view transitions: the settings panels and the theme are re-bound on `astro:page-load`. The banner script itself may not re-run on client-side navigations (not verified here); test your setup if you use them.

## Consent manager

Consent is per service. The banner offers accept all, reject all and settings; the settings dialog lets the visitor switch each service on or off inside its category. `<ConsentSettings>` is the same manager as a page section: put it on your privacy or cookie page.

```astro
---
import config from '../consent.config'
import ConsentSettings from 'cloveconsent/astro/ConsentSettings.astro'
---
<ConsentSettings config={config} locale="sk" />
```

Props: `config`, `locale` and an optional `class`. The panel shows

- the consent reference with a copy button, the time, the policy version, the language and what was chosen (`ui.manager.receipt`),
- every category with a switch, and every service inside it with its own switch (`serviceToggles`) and a table of what it stores (`storageTables`),
- the processors (`processors`),
- Accept all, Reject all and Save buttons, and a Withdraw button that appears while anything is accepted (`withdraw`).

It shows only what the visitor has actually chosen (a service held back by a re-consent prompt is shown as off), and it updates when a choice is made in the banner.

Without JavaScript nothing can be saved, so the server-rendered panel is read-only: the switches are disabled and there are no buttons. With JavaScript the page script (started by `<ConsentBanner>`, so keep that on every page) turns it interactive. Panels are bound automatically, including after Astro view transitions. `<ConsentPreferences>` (a plain, non-interactive list of the categories and services) and `<ProcessorList>` remain available if you only want to describe them.

## UI settings

Banner, dialog, manager and theme are set with the optional `ui` key of `defineConsent`. Every key is optional; an unknown key or an invalid value throws at build time with the path of the problem (for example `ui.banner.position: must be one of: top, bottom`). Defaults are exported as `DEFAULT_UI`.

```ts
defineConsent({
  /* ... */
  ui: {
    banner: { layout: 'box', position: 'bottom right' },
    manager: { details: 'open' },
    theme: { tokens: { primary: '#193637', radius: '0.25rem' } },
  },
})
```

| Setting | Default | Values |
| --- | --- | --- |
| `banner.layout` | `'bar'` | `'bar'`, `'box'`, `'cloud'` |
| `banner.position` | `'bottom'` | `bar`: `'top'`, `'bottom'`. `box` and `cloud`: `'top'`, `'bottom'`, `'top left'`, `'top center'`, `'top right'`, `'bottom left'`, `'bottom center'`, `'bottom right'`, `'middle'`, `'middle center'` |
| `banner.equalWeightButtons` | `true` | `true` makes accept and reject look the same; `false` lets the engine style one as secondary |
| `banner.flipButtons` | `false` | `true` reverses the button order |
| `dialog.layout` | `'box'` | `'box'`, `'bar'` |
| `dialog.position` | `'right'` | `'left'`, `'right'` |
| `manager.receipt` | `true` | show the consent reference, time and choice in the panel |
| `manager.serviceToggles` | `true` | `true`: a switch per service. `false`: choices are made and stored per category (see below) |
| `manager.storageTables` | `true` | show what each service stores |
| `manager.processors` | `true` | list the processors in the panel |
| `manager.withdraw` | `true` | show a Withdraw button while anything is accepted |
| `manager.details` | `'collapsed'` | `'open'` or `'collapsed'`: whether the services of a category start expanded |
| `theme.tokens` | `{}` | see "Colours and theme" |

`serviceToggles: false` is the per-category mode: the visitor switches whole categories, and accepting a category accepts every service in it. A cookie written with toggles on that lists services is still honoured as written.

## Colours and theme

The banner, the dialog and the panels share one stylesheet (`src/astro/consent.css`). The Astro components import it themselves, so there is nothing to add. Outside Astro, import `cloveconsent/consent.css` (and the engine's own `vanilla-cookieconsent/dist/cookieconsent.css` for the banner).

It reads your site's colour tokens, the shadcn-style names that Tailwind themes usually define:

| Token | Used for | Fallback (light / dark) |
| --- | --- | --- |
| `--background` | surfaces | `#ffffff` / `#111827` |
| `--foreground` | text | `#111827` / `#f9fafb` |
| `--primary` | buttons, links, switches that are on | `#1f2937` / `#f3f4f6` |
| `--primary-foreground` | text on primary | `#ffffff` / `#111827` |
| `--muted` | quiet surfaces | `#f3f4f6` / `#1f2937` |
| `--muted-foreground` | secondary text | `#4b5563` / `#9ca3af` |
| `--border` | borders and separators | `#d1d5db` / `#374151` |
| `--ring` | focus outline | `#2563eb` / `#60a5fa` |

**The tokens must be complete colour values**, as Tailwind v4 and current shadcn define them (`--primary: oklch(0.21 0.03 265)`, `--primary: #193637`). Classic shadcn on Tailwind v3 defines bare HSL channels instead (`--primary: 222 47% 11%`); read with `var()` that is not a colour, the declaration is invalid and, for example, the primary buttons turn transparent. With channel-style tokens, set every colour in `ui.theme.tokens`. The validator does not accept `hsl(var(--primary))` (a function around `var()`), so either give literal colours (`primary: 'hsl(222 47% 11%)'`) or define complete colours in your own CSS and point at them:

```css
:root { --consent-site-primary: hsl(var(--primary)); --consent-site-primary-fg: hsl(var(--primary-foreground)); /* ... */ }
```

```ts
ui: { theme: { tokens: { primary: 'var(--consent-site-primary)', primaryForeground: 'var(--consent-site-primary-fg)' /* ... */ } } }
```

`--radius` (fallback `0.5rem`) and `--font-family` (fallback: inherit the page font) are read too. If your site defines none of these, the neutral fallbacks apply and the result is still readable. Dark mode follows the `.dark` class on `<html>`, the usual Tailwind setup (`darkMode`, default on, keeps the engine's own `.cc--darkmode` class in step). Set the tokens in both modes as you already do for the rest of your site.

Layers: the stylesheet declares `@layer theme, base, components, utilities`, the same order Tailwind uses, and puts its `.consent-*` rules in `components`. With Tailwind v4, which puts its own CSS in those cascade layers, it therefore works alongside the preflight, and your utility classes (`<ConsentSettings class="mt-8">`) still override it. With Tailwind v3, or any site CSS that is not in a layer, this does not hold: unlayered rules beat every layered rule, so a site rule such as `button { ... }` or `input { ... }` can override the `.consent-*` styles. Put such rules in a layer, or scope them away from the consent components. The class names are stable: `consent-settings`, `consent-preferences`, `consent-processors`, `consent-placeholder`, `consent-reopen`, `consent-category`, `consent-service`, `consent-receipt`, `consent-btn`, `consent-switch` and `consent-table`.

To override colours without touching your site's tokens, set `ui.theme.tokens`. Names: `background`, `foreground`, `primary`, `primaryForeground`, `muted`, `mutedForeground`, `border`, `ring` (a colour: hex, `rgb()`, `hsl()`, `oklch()`, `oklab()` or `var(--name)`), `radius` (a length such as `0.5rem` or `8px`) and `fontFamily` (letters, digits, spaces, commas and quotes, or `inherit`). Each value is at most 100 characters and is validated strictly; anything else, including anything that looks like CSS, throws at build time. The values are applied to `<html>` as `--consent-override-<name>` custom properties with `style.setProperty` (never as CSS text), and again after each Astro view transition. An override beats your site's token, which beats the fallback.

## Per-service client API

```ts
import { getConsent } from 'cloveconsent'

const consent = getConsent() // null until the banner has booted

consent.setServices(['youtube', 'google-analytics']) // exactly these optional services; [] accepts none
consent.acceptService('youtube')                     // one more, keeping the ones already accepted
consent.withdraw()                                   // withdraw everything: a decision of kind 'withdraw'

consent.isAllowed('youtube')                         // may it run right now?
consent.acceptedServices()                           // ids of the services the visitor has chosen
```

- `setServices` and `acceptService` throw for an unknown service id. Ids of `necessary` services are ignored (they are always allowed).
- `isAllowed(id)` is what to gate on: it is true for necessary services, for a stored and current choice, and for a one-time allowance from `allowOnce(id)`.
- `acceptedServices()` is only the persisted part: it leaves out `allowOnce` allowances, necessary services, and any service held back by a re-consent prompt (new service, bumped `catalogRevision` or site `revision`). Use it to show what the visitor has actually chosen; use `isAllowed` to decide whether to run something.
- `acceptAll()`, `rejectAll()`, `open()` and `acceptCategory(category)` still work. In the `serviceToggles: false` mode, a service is accepted when its category is.

### Withdrawal, one-time allowances and leftovers

- After a visitor withdraws consent for a **script-type** service, the already-executed script's side effects (globals, timers, a tracker rewriting cookies) cannot be undone. For such services, recommend a page reload after withdrawal. Storage the client could not clear is reported in `consent.leftovers`.
- `allowOnce(id)` on a script-type service throws: scripts cannot be allowed once. Embeds (iframes) load immediately.
- A persisted decision (accept, reject, change or withdraw) supersedes one-time allowances.

## Analytics and marketing entries

All three load their script only after consent, and run their small setup step themselves as library code (`gating.init`). No inline script is needed on your pages, so a strict Content-Security-Policy keeps working: merge `cspSources(config)` into your policy as shown in "Security notes". Each takes an ID that is validated at build time.

```ts
import { googleAnalytics, googleTagManager, metaPixel } from 'cloveconsent/catalog'

services: [
  googleAnalytics({ measurementId: 'G-XXXXXXXXXX' }),
  googleTagManager({ containerId: 'GTM-XXXXXXX' }),
  metaPixel({ pixelId: '123456789012345' }),
]
```

| Entry | Option | Format | Default category | Service id |
| --- | --- | --- | --- | --- |
| `googleAnalytics` | `measurementId` | `G-` and 4 to 20 capitals or digits | `analytics` | `google-analytics` |
| `googleTagManager` | `containerId` | `GTM-` and 4 to 10 capitals or digits | `marketing` | `google-tag-manager` |
| `metaPixel` | `pixelId` | 5 to 20 digits | `marketing` | `meta-pixel` |

Each also accepts an optional `category` to override the default. These entries are **UNVERIFIED** (`lastVerified: null`): hosts, cookie names and lifetimes were written from memory and have not been checked against the providers' documentation (see "Legal review needed"). Google Tag Manager is gated as a whole container: the tags inside it are **not** gated individually, so it defaults to `marketing`, lists no storage (unknown, not none), and you must list what your tags store and extend the CSP yourself.

## Legal review needed

> - Putting `theme` (or any theme/branch choice) in `functional` rather than `necessary` is a **legal call** that the code does not make for you. Decide it with your adviser.
> - The `fr` and `de` texts are **unreviewed drafts** (catalog entries are flagged `unreviewed`).
> - The package supplies **facts**, never legal wording or a legal basis. Your privacy notice and its wording remain your responsibility.
> - Catalog entries carry `lastVerified` only where the provider's own documentation backed every fact (see `docs/catalog-verification.md`). Turnstile, YouTube, Facebook Graph, `hosting()`, `googleAnalytics()`, `googleTagManager()` and `metaPixel()` are still `null`: treat them as unverified (for the last three, hosts, cookie names and lifetimes were written from memory), and note that an empty `storage` on an unverified client entry means unknown, not none (Google Tag Manager's depends on the tags in your container).
> - The catalog `theme` entry assumes the site stores the choice in `localStorage` under the key `theme` (verified for blindman.sk only). If yours differs, the entry is wrong for your site.

## Security notes

- No raw HTML: service titles, descriptions and notes are rendered as text, never as markup.
- Origin allowlists: an embed or script `src` must be https, must not contain credentials, and its host must be in the service's `origins`. Anything else is refused.
- CSP helper: `cspSources(config)` returns sorted host lists for `script-src`, `frame-src`, `connect-src` and `img-src`, derived from the selected client services. The analytics and pixel entries run their setup from library code, so no inline script (and no `'unsafe-inline'`) is needed for them. Merge the lists into your policy:

  ```ts
  import { cspSources } from 'cloveconsent'
  import config from './consent.config'

  const csp = cspSources(config) // { 'script-src': [...], 'frame-src': [...], ... }
  ```

- Cookie flags: the consent cookie is `Path=/; SameSite=Lax`, lives 182 days, and is `Secure` when the page is served over https.
- `window.CookieConsent` is frozen and exposes only `acceptAll()`, `rejectAll()` and `getState()`.
- The logger refuses non-https endpoints (except http between localhost addresses), credentials in the URL and cross-origin paths, and sends no cookies (`credentials: 'omit'`).
- Install with `npm ci --ignore-scripts`; CI also runs `npm audit --omit=dev --audit-level=high`.

## Changes

- **Message key `embedAccept` is now `embedAllow`** (the embed placeholder's "Allow {service}" button). A site that overrides `embedAccept` in its own language pack must rename the key. There is no alias: the old key is now an unknown message key, and building the configuration throws (`... .messages.embedAccept: unknown message key`).
- `acceptCategory` and `acceptService` (the embed "Allow" button) keep only consent that is stored and current. A service the visitor refused stays refused, and a service held back by re-consent (new, revised or a bumped site `revision`) is not re-granted by answering for another service.
- `createConsentLogger`: the record also carries `services`, `timestamp` and, when you pass the `DecisionInfo`, `kind`, `changed`, `changedServices` and `locale`.

## Local development

- `Secure` is only set on https, so the cookie works on `http://localhost`.
- Local sites on different ports share the `localhost` cookie jar (cookies ignore ports). Give each site its own `cookieName` (`^[A-Za-z0-9_-]{1,64}$`) so they do not overwrite each other's decision.
- Cloudflare Turnstile on localhost needs `localhost` in the widget's allowed hostnames, or Cloudflare's test keys.

## Local admin

`npm run admin` starts a local, view-only dev tool at http://localhost:4321. It reads `src/` directly, so edits to the catalog or language packs show up on reload. It is not part of the published package and never writes to the repo; all changes to defaults are made in code.

- **Catalog**: every service and processor with category, storage, gating, origins and `lastVerified` (unverified entries are flagged). Expand a row for the full entry and its `notes`.
- **Languages**: every banner and catalog text against each language pack, with missing translations and unreviewed packs highlighted.
- **Playground**: pick languages, services, processors and options and see the real banner and preferences panel, with the same validation errors a site build would give.
- **Manager** (`/manager`): the real banner, settings panel (`ConsentSettings`), processor list and a gated embed with the playground's default config. Switch between light, dark and no site tokens (to see the neutral fallbacks) and between the `bar`, `box` and `cloud` banner layouts with the links at the top. View only; nothing is saved.

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
