# Standalone Runtime (Phase 2, Plan 1 of 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the cloveconsent library run on any website from one script tag: blocking by marked tags and auto-blocking, placeholders for every blocked visual element, the settings panel in a placeholder element, consent records to a configurable URL, and a builder that produces the per-site script for the hosted CMP and the one-time export.

**Architecture:** New browser modules (`marked.ts`, `placeholder.ts`, `autoblock.ts`, `standalone.ts`) build on the existing client, gating, panel and logger. A tsup IIFE build produces the runtime; a Node-side `buildSiteScript()` concatenates the runtime with a site's validated public configs into one self-contained file. Real blocking is verified in Chromium with Playwright, not only in jsdom.

**Tech Stack:** TypeScript, vitest (jsdom), tsup, vanilla-cookieconsent 3.1.0, Playwright (Chromium) for browser tests.

**Spec:** `docs/superpowers/specs/2026-11-10-hosted-cmp-design.md` (sections Runtime on customer sites, Blocking, Placeholders for blocked visual elements, One-time purchase) building on `docs/superpowers/specs/2026-11-09-consent-manager-core-design.md`.

**Plans in this phase (one per subsystem, in order):** 1 Standalone runtime (this plan, in this repo) · 2 SaaS foundation: accounts, tenancy, sites, editor, publishing, runtime delivery, consent records (new repo) · 3 Scanner and blocking check · 4 Billing interface, manual provider, one-time export · 5 Public site. Each later plan is written when its predecessor is merged.

## Global Constraints

- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Verification: `npm run typecheck`, `npm test`, `npm run test:astro`, `npm run test:admin`, and the new `npm run test:browser` all pass before the last task is done.
- "Before consent nothing optional runs, loads or sends a request." Anything the runtime cannot guarantee is reported, never assumed.
- "Every blocked visual element ... shows a message in its place, sized like the element, saying it is blocked because of the visitor's choice, with "Allow <service>" and "Load once" and a link to settings. Never blank space."
- No user-facing words in source: every visible string comes from `Messages` (en source, sk/fr/de packs, strict policy: every new key in all three packs).
- The library never creates an inline script of its own; the only inline scripts it activates are the site owner's own marked inline scripts. Styles are applied through constructable stylesheets (`adoptedStyleSheets`) or the CSSOM, never `<style>` text, so customer CSPs without `unsafe-inline` keep working.
- Consent cookie stays within 4096 bytes; configs that could exceed it are rejected at build time.
- Hosts are lowercase plain hostnames; script and iframe sources are activated only when their host is in the service's `origins`.
- Escaping of every dynamic value in generated markup (`escapeHtml`); JSON embedded in the site script is escaped for `<`, `>`, `&`, U+2028, U+2029.
- Not legal advice.

## Review Focus

1. A marked script whose `data-consent` names a service the config does not have stays blocked and is reported, never run. Pinned in Task 2.
2. A tracker tag placed in the HTML after the snippet, or inserted later by another script (`createElement` plus `appendChild`, `innerHTML`, `insertAdjacentHTML`, `setAttribute('src')`), never executes or requests before consent in Chromium. Pinned in Task 3.
3. An iframe with no width/height attributes but CSS sizing gets a placeholder of the same rendered size, and a 0-size iframe still gets a visible placeholder (min size). Pinned in Task 1.
4. Withdrawing consent after a marked script or iframe was activated turns iframes back into placeholders and reports scripts that cannot be undone (`consent.leftovers`), without a reload. Pinned in Task 2.
5. A page whose `<html lang>` is missing or not among the site's languages boots in the site's default language, and a language tag like `de-AT` picks `de`. Pinned in Task 4.

---

## File Structure

- Create `src/placeholder.ts`: placeholder markup renderer and mount/unmount for blocked iframes and widget containers.
- Create `src/marked.ts`: activation and deactivation of marked scripts and iframes.
- Create `src/autoblock.ts`: interception of scripts and iframes added after the runtime starts.
- Create `src/known-hosts.ts`: static map of known tracker hosts to catalog ids (for unconfigured trackers).
- Create `src/standalone.ts`: `boot(bundle)` entry for the IIFE build; locale picking; records and reports.
- Create `src/site-script.ts`: Node-side `buildSiteScript(input)`.
- Create `src/styles.ts`: adopt the stylesheets through `adoptedStyleSheets`.
- Modify `src/schema.ts`, `src/config.ts` (cookie size check, `cookieDomain`, `records`), `src/driver-vcc.ts` (cookie domain), `src/messages.ts` and packs, `src/ui.ts` (reuse placeholder renderer), `src/astro/GatedEmbed.astro` (same), `tsup.config.ts`, `package.json` (exports `./site-script`, `./standalone`; script `test:browser`; devDependency `@playwright/test`), `README.md`.
- Tests: `test/placeholder.test.ts`, `test/marked.test.ts`, `test/autoblock.test.ts`, `test/standalone.test.ts`, `test/site-script.test.ts`, `test/cookie-size.test.ts`, browser tests in `browser/*.spec.ts` with fixtures in `browser/fixtures/`.

---

### Task 1: Placeholder renderer and new texts

**Files:**
- Create: `src/placeholder.ts`
- Modify: `src/messages.ts`, `src/locales/sk.ts`, `src/locales/fr.ts`, `src/locales/de.ts`, `src/ui.ts` (`syncEmbeds` uses the renderer), `src/astro/GatedEmbed.astro`, `src/astro/consent.css` (placeholder sizing)
- Test: `test/placeholder.test.ts`, `test/messages.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function renderPlaceholder(view: View, serviceId: string, label?: string): string   // markup for one blocked element
  export function mountPlaceholder(target: HTMLElement, html: string, size: { width: string; height: string } | null): HTMLElement // replaces target, returns placeholder
  export function measure(el: HTMLElement): { width: string; height: string } | null
  ```
- Placeholder markup contract: `div.consent-placeholder[data-consent-placeholder-for="<service-id>"]` containing a `p.consent-placeholder__text`, buttons `[data-consent-action="once"]` (only for iframe services), `[data-consent-action="accept"]`, and a link/button `[data-consent-open]` with text `reopen`.
- Messages: `embedBlocked` changes to "{service} is turned off because of your cookie choice." and a new key `embedHint`: "Turn on {category} cookies to see it." (`{category}` is the translated category title). sk/fr/de updated for both.

- [ ] **Step 1: Write failing tests:** `renderPlaceholder` output for `youtube` contains the escaped service title in the text, a category hint naming the translated media category, an accept button labelled with `embedAllow`, a "once" button (iframe service) and no "once" button for a script service; HTML in a title is escaped; `measure` returns attribute sizes (`width="560"` becomes `560px`), falls back to computed `getBoundingClientRect` sizes, and returns null for 0×0; `mountPlaceholder` with a null size applies the CSS class that gives a minimum size (`consent-placeholder--min`); every pack has `embedHint` and the `{service}` and `{category}` placeholders.
- [ ] **Step 2: Run** `npx vitest run test/placeholder.test.ts test/messages.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Make `syncEmbeds` and `GatedEmbed.astro` use `renderPlaceholder` so there is one placeholder markup. In `consent.css`, add `.consent-placeholder` sizing that respects an inline width/height or aspect ratio and a `--min` modifier (min 16rem × 9rem), logical properties only.
- [ ] **Step 4: Run** `npm test`, `npm run test:astro`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(placeholder): one placeholder for every blocked visual element`.

### Task 2: Marked tags

**Files:**
- Create: `src/marked.ts`
- Test: `test/marked.test.ts`

**Interfaces:**
- Consumes: `Consent` (`isAllowed`, `on`, `config`, `leftovers`), `renderPlaceholder`/`mountPlaceholder`/`measure` (Task 1), `hostAllowed` (src/gating.ts).
- Produces:
  ```ts
  export interface MarkedOptions { onUnknown?(serviceId: string, el: Element): void }
  export function bindMarked(consent: Consent, doc: Document, opts?: MarkedOptions): () => void
  export function syncMarked(consent: Consent, doc: Document, opts?: MarkedOptions): void
  ```
- Markup contract (documented in README by Task 7): scripts `<script type="text/plain" data-consent="<id>" [data-type="module"] [src="..."]>`; iframes `<iframe data-consent="<id>" data-consent-src="https://...">`; widget containers `<div data-consent-placeholder="<id>"></div>`; the widget's own script is a marked script with the same id.

- [ ] **Step 1: Write failing tests** (jsdom): an allowed service's marked external script is replaced by a new `script` element with the original attributes, `type` taken from `data-type` or omitted, and `src` set; a src whose host is not in the service's `origins` stays blocked and `onUnknown` is not called but a dev warning is logged; an unknown `data-consent` id stays blocked and calls `onUnknown(id, el)` (Review Focus 1); a marked inline script is activated with its text when allowed; each script is activated at most once even after repeated syncs and decisions; iframes get a placeholder (Task 1) until allowed, then `src` from `data-consent-src` with the iframe restored in place; widget containers show the placeholder until allowed and become empty containers when allowed (so the widget script can render into them); withdrawing replaces activated iframes with placeholders again and adds activated scripts' storage to `consent.leftovers` through `unloadService` (Review Focus 4); `allowOnce` from a placeholder activates only that element's service for this page view.
- [ ] **Step 2: Run** `npx vitest run test/marked.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with one delegated click listener for placeholder buttons (reuse the `[data-consent-action]` handling style of `bindDom` in src/ui.ts; do not duplicate the embed logic, generalize it), subscribing to `ready`, `decision` and `once`, and `astro:page-load`.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(marked): activate marked scripts and iframes on consent`.

### Task 3: Auto-blocking and browser tests

**Files:**
- Create: `src/autoblock.ts`, `src/known-hosts.ts`, `browser/playwright.config.ts`, `browser/autoblock.spec.ts`, `browser/fixtures/` (static pages and a fake tracker script)
- Modify: `package.json` (devDependency `@playwright/test` pinned exact; script `"test:browser": "npm run build && playwright test -c browser/playwright.config.ts"`), `.github/workflows/ci.yml` (install Chromium, run `test:browser`)
- Test: `test/autoblock.test.ts` (unit), `browser/autoblock.spec.ts` (Chromium)

**Interfaces:**
- Produces:
  ```ts
  export interface AutoBlockOptions {
    serviceForHost(host: string): string | null   // configured or known service id for a host, null if not a tracker
    isAllowed(serviceId: string): boolean
    onBlocked?(serviceId: string, el: Element, configured: boolean): void
  }
  export function installAutoBlocking(doc: Document, opts: AutoBlockOptions): { release(serviceId: string): void; stop(): void }
  export const KNOWN_HOSTS: Readonly<Record<string, string>>   // host -> catalog id, e.g. 'www.googletagmanager.com' -> 'google-tag-manager'
  ```
- Neutralized elements become marked tags (`type="text/plain"`, `data-consent=<id>`, `data-consent-src` for iframes, `data-consent-auto`) so `bindMarked` (Task 2) activates them on consent; `release` is how the runtime tells auto-blocking a service is now allowed.

- [ ] **Step 1: Write failing tests.** Unit (jsdom): `createElement('script')` then `src=` / `setAttribute('src', ...)` for a tracker host results in a neutralized element after insertion; non-tracker hosts are untouched; `onBlocked` reports `configured: false` for a known host not in the config. Chromium (Playwright, fixture pages served locally, tracker URLs on a fake host fulfilled by `page.route` that records requests): with no consent, (a) a tracker `<script src>` placed in the HTML after the runtime tag, (b) one inserted by `appendChild`, (c) by `innerHTML` of a container, (d) by `insertAdjacentHTML`, (e) an iframe added later: none executes (a global flag set by the tracker stays unset) and no request reaches the fake host (Review Focus 2); after Accept all each runs once. Tags placed above the runtime tag are outside auto-blocking's reach by design (the scanner in plan 3 reports them); do not test them here.
- [ ] **Step 2: Run** `npx vitest run test/autoblock.test.ts` and `npm run test:browser`. Expected: FAIL.
- [ ] **Step 3: Implement.** Combine a `MutationObserver` on `document.documentElement` (childList, subtree) that neutralizes parser-inserted and DOM-inserted scripts and iframes before they execute or load, with patched `src` setters / `setAttribute` on elements created through `document.createElement` for script and iframe, so a source set after creation is caught before insertion. Keep the patches minimal, restore nothing globally that other code relies on, and never throw into host code. `KNOWN_HOSTS` lists the hosts of every catalog entry plus common tracker hosts that the catalog will cover (document the source of each host as unverified where it is).
- [ ] **Step 4: Run** the Step 2 commands plus `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(autoblock): block trackers added after the runtime, verified in Chromium`.

### Task 4: Config additions: cookie size, cookie domain, records URL, locale picking

**Files:**
- Modify: `src/schema.ts`, `src/config.ts`, `src/driver-vcc.ts`, `src/view.ts` if needed
- Create: `src/locale-pick.ts`
- Test: `test/cookie-size.test.ts`, `test/config.test.ts`, `test/driver-vcc-real.test.ts`, `test/locale-pick.test.ts`

**Interfaces:**
- `ConsentConfigInput` gains `cookieDomain?: string` (validated hostname; at runtime used only if `location.hostname` equals it or ends with `.`+it, otherwise ignored with a dev warning) and `records?: { url: string }` (validated like the logger endpoint: https or same-origin path). Both carried in public JSON.
- `export function maxCookieBytes(config: ConsentConfig): number` (worst case: every optional service accepted, longest ids, all revisions, the engine's format); `defineConsent` throws `ConsentConfigError` at path `services` when it exceeds 4096.
- `export function pickLocale(available: readonly string[], htmlLang: string | null, preferred: readonly string[], fallback: string): string` in `src/locale-pick.ts` (exact match, then language prefix, then preferred list, then fallback).

- [ ] **Step 1: Write failing tests:** `maxCookieBytes` agrees with the real engine within 2% for the shipped catalog plus 40 generated services (real engine, as in the existing cookie-size test), and a config with 120 long-id services is rejected with a message naming the limit; `cookieDomain` is passed to the engine's cookie options when the host matches and ignored otherwise; `records.url` validation (http rejected except localhost, credentials rejected); public JSON round-trip of both fields; `pickLocale('de-AT')` gives `de`, missing `lang` gives the fallback, `pt-BR` with only `pt` gives `pt` (Review Focus 5).
- [ ] **Step 2: Run** the four test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(config): cookie size limit, cookie domain, records URL, locale picking`.

### Task 5: Standalone boot

**Files:**
- Create: `src/standalone.ts`, `src/styles.ts`
- Test: `test/standalone.test.ts`

**Interfaces:**
- Consumes: Tasks 1-4, `createConsent`, `createVccDriver`, `bindDom`, `bindSettings`, `renderSettings`, `buildView`, `applyTheme`, `createConsentLogger`, `fromPublicJson`.
- Produces:
  ```ts
  export interface StandaloneBundle {
    site: string                       // site key, sent with records
    defaultLocale: string
    configs: Record<string, string>    // locale -> toPublicJson output
    reportUrl?: string                 // where unconfigured-tracker reports go (hosted CMP only)
  }
  export function boot(bundle: StandaloneBundle, doc?: Document): Consent | null
  export function adoptStyles(doc: Document): void   // src/styles.ts; consent.css + engine css via adoptedStyleSheets
  ```
- `boot` order: install auto-blocking first (synchronously), pick the locale from `<html lang>` and `navigator.languages`, parse that locale's config with `fromPublicJson`, create the client, bind embeds, marked tags and placeholders, render the settings panel into every `[data-cloveconsent-settings]` and bind it, apply theme overrides, adopt styles, send records on each `decision` when `records.url` is set (with the site key), report unconfigured trackers to `reportUrl` (deduplicated per page view, sendBeacon, no personal data: service id, page path without query, timestamp). Calling `boot` twice returns the existing client.

- [ ] **Step 1: Write failing tests** (jsdom with the real engine where needed): boot with a two-locale bundle picks the page's language; the panel renders into `[data-cloveconsent-settings]` and is interactive; a decision posts one record to `records.url` containing the site key, the consent reference and `kind`; an unconfigured tracker is reported once to `reportUrl`; a malformed config for the chosen locale makes `boot` return null, log once, and leave all marked tags blocked; styles are adopted without creating any `<style>` element; second `boot` returns the same client.
- [ ] **Step 2: Run** `npx vitest run test/standalone.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(standalone): boot the runtime from one bundle`.

### Task 6: Build and site script

**Files:**
- Create: `src/site-script.ts`
- Modify: `tsup.config.ts` (IIFE build of `src/standalone.ts` to `dist/standalone/cloveconsent.js`, minified, global `CloveConsent`, CSS texts inlined as strings), `package.json` (exports `./site-script` and `./standalone`)
- Test: `test/site-script.test.ts`, `browser/site-script.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SiteScriptInput { site: string; config: ConsentConfig; reportUrl?: string }
  export function buildSiteScript(input: SiteScriptInput): Promise<string>   // runtime + `CloveConsent.boot(<escaped JSON>)`, one file
  ```
  It produces one public JSON per enabled locale with `toPublicJson`, escapes `<`, `>`, `&`, U+2028, U+2029, and appends one boot call to the runtime text read from `dist/standalone/cloveconsent.js`.

- [ ] **Step 1: Write failing tests:** the output parses as JavaScript, contains no `</script` sequence even when a text contains it, boots in a jsdom window; a size budget test: gzipped output for a site with 6 services in 2 languages is at most 30 KB (if this cannot be met, stop and report the measured size instead of raising the limit); Chromium: a fixture page with only `<script src="site.js">` first in `<head>`, marked tags and a widget placeholder shows the bottom bar, blocks, allows on Accept all, and the settings panel works.
- [ ] **Step 2: Run** `npx vitest run test/site-script.test.ts` and `npm run test:browser`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** all suites. Expected: PASS.
- [ ] **Step 5: Commit** `feat(build): standalone runtime bundle and per-site script builder`.

### Task 7: End-to-end blocking suite and docs

**Files:**
- Create: `browser/blocking.spec.ts`
- Modify: `README.md`
- Test: `browser/blocking.spec.ts`

- [ ] **Step 1: Write the browser suite** on a fixture site built with `buildSiteScript` containing YouTube and Maps iframes, a Google Analytics marked script, a Meta Pixel marked script, a widget container, and an unmarked tracker tag below the snippet: with no consent there are no requests to any tracker host and no cookies other than the consent cookie after a decision; every blocked visual element shows a placeholder with a size equal to the element's (±1px) or the minimum size; Reject all keeps it so; allowing YouTube from its placeholder loads it without reload; Withdraw restores placeholders; the per-service toggle for Analytics alone allows only Analytics.
- [ ] **Step 2: Run** `npm run test:browser`. Expected: PASS (fix code, not tests, if anything fails).
- [ ] **Step 3: Document** in README: install with one script tag first in `<head>`, marked tag syntax for scripts, iframes and widgets, auto-blocking and its limit (tags above the snippet), placeholders, records URL, cookie domain, locale picking, `buildSiteScript` for hosted and self-hosted use.
- [ ] **Step 4: Run** `npm run typecheck && npm test && npm run test:astro && npm run test:admin && npm run test:browser`. Expected: all PASS.
- [ ] **Step 5: Commit** `test(browser): end-to-end blocking suite; docs for the standalone runtime`.
