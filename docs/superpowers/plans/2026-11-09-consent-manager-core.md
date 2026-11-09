# Consent Manager Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-service consent with group control, a modular `ui` settings layer, an embeddable settings panel with a consent reference, a themed bottom-bar banner, and analytics/marketing catalog entries.

**Architecture:** Consent state gains per-service choices read from the vanilla-cookieconsent cookie. A new validated `ui` object on the config (resolved with defaults, carried in the public JSON) drives the banner, dialog, panel and theme. The panel is a pure HTML renderer (`src/settings.ts`) plus a DOM binder (`src/panel.ts`) wrapped by an Astro component; one stylesheet maps the site's color tokens onto the engine and the panel.

**Tech Stack:** TypeScript, vitest (jsdom), tsup, Astro 7, vanilla-cookieconsent 3.1.0.

**Spec:** `docs/superpowers/specs/2026-11-09-consent-manager-core-design.md`

## Global Constraints

- Every commit message ends with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Verification commands: `npm run typecheck`, `npm test`, `npm run test:astro`, `npm run test:admin`. All must pass before the last task is done.
- Strict translation policy: every new visitor-facing text exists in en and in the sk, fr, de packs (`reviewed: false` draft translations), or `defineConsent` throws.
- Colors: the site's shadcn-style tokens `--background`, `--foreground`, `--primary`, `--primary-foreground`, `--muted`, `--muted-foreground`, `--border`, `--ring`, dark mode through a `.dark` class on `html`. A missing token falls back to a neutral built-in color.
- Plain CSS with stable class names. No Tailwind utility classes and no Tailwind setup required in the library or the host.
- Banner default: full-width bottom bar with equal-weight Accept, Reject and Settings buttons. Every look and behavior is a `ui` setting with a default; no site-specific value (domain, ID, brand color) hard-coded except the neutral fallbacks.
- The consent reference is the stored `consentId`, shown as stored. Cookie size stays within `MAX_COOKIE_LENGTH` (4096).
- No inline scripts and no injected CSS text: script setup runs as library code, theme overrides are applied with `style.setProperty`.
- Catalog entries: `lastVerified` only when provider documentation backs every fact, otherwise `null` and "UNVERIFIED" in `notes`. Text fields at most 600 characters, hosts lowercase plain hostnames (no wildcards).
- Not legal advice.

## Review Focus

1. A cookie from the old category-only format (no `services` field) must not crash and must allow every service of an accepted category. Pinned in Task 2.
2. A service added or revised in a category the visitor already accepted stays blocked until they answer again. Pinned in Task 2.
3. The stored cookie with the full shipped catalog and 40 extra services selected must stay under 4096 characters. Pinned in Task 3.
4. The panel rendered twice, or the page swapped by Astro view transitions, must not bind listeners twice or double-fire decisions. Pinned in Task 9.
5. The panel before any decision (no reference, no state) must render, Save must create the first decision, and Withdraw must be hidden. Pinned in Task 9.

---

## File Structure

- Create `src/ui-settings.ts`: `UiSettings` types, defaults, `resolveUi`, validation.
- Create `src/settings.ts`: pure panel model and HTML renderer.
- Create `src/panel.ts`: DOM binder for the panel and theme application.
- Create `src/astro/ConsentSettings.astro`, `src/astro/consent.css`.
- Modify `src/schema.ts`, `src/state.ts`, `src/client.ts`, `src/driver.ts`, `src/driver-vcc.ts`, `src/ui.ts`, `src/config.ts`, `src/messages.ts`, `src/gating.ts`, `src/validate.ts`, `src/view.ts`, `src/index.ts`, `src/catalog/index.ts`, `src/i18n/resolve.ts`, the three packs in `src/locales/`, the existing Astro components, `package.json`, `README.md`.
- Create `src/catalog/google-analytics.ts`, `src/catalog/google-tag-manager.ts`, `src/catalog/meta-pixel.ts`.
- Admin: create `admin/src/pages/manager.astro`; modify `admin/src/lib/catalog.ts` (sample args for the new factories).
- Tests are added to the existing files named in each task, following their helpers and style.

---

### Task 1: `ui` settings model

**Files:**
- Create: `src/ui-settings.ts`
- Modify: `src/schema.ts` (add `ui?: UiSettingsInput` to `ConsentConfigInput`, `readonly ui: UiSettings` to `ConsentConfig`), `src/config.ts`, `src/index.ts`
- Test: `test/ui-settings.test.ts`, `test/config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const THEME_TOKENS = ['background','foreground','primary','primaryForeground','muted','mutedForeground','border','ring','radius','fontFamily'] as const
  export type ThemeToken = (typeof THEME_TOKENS)[number]
  export interface UiSettings {
    banner: { layout: 'bar'|'box'|'cloud'; position: string; equalWeightButtons: boolean; flipButtons: boolean }
    dialog: { layout: 'box'|'bar'; position: 'left'|'right' }
    manager: { receipt: boolean; serviceToggles: boolean; storageTables: boolean; processors: boolean; withdraw: boolean; details: 'open'|'collapsed' }
    theme: { tokens: Partial<Record<ThemeToken, string>> }
  }
  export type UiSettingsInput = { [K in keyof UiSettings]?: Partial<UiSettings[K]> }
  export const DEFAULT_UI: UiSettings   // banner {bar, 'bottom', true, false}; dialog {box, 'right'}; manager {receipt, serviceToggles, storageTables, processors, withdraw all true; details 'collapsed'}; theme {tokens: {}}
  export function resolveUi(input: unknown, path?: string): UiSettings   // throws ConsentConfigError
  ```
- `ConsentConfig.ui` is the resolved, frozen object; `toPublicJson` carries it and `fromPublicJson` re-validates it.

- [ ] **Step 1: Write failing tests** in `test/ui-settings.test.ts`: `resolveUi(undefined)` equals `DEFAULT_UI`; a partial `{banner:{layout:'box',position:'bottom left'}}` keeps the other defaults; rejects `{banner:{layout:'bar',position:'middle'}}` (bar allows only `top`/`bottom`); rejects unknown keys (`{banner:{colour:'x'}}`); rejects `{manager:{details:'maybe'}}`; theme tokens accept `#193637`, `rgb(0 0 0 / 50%)`, `oklch(0.5 0.1 200)`, `var(--brand)` and reject `red; background:url(x)`, `url(x)`, `expression(1)`, a value over 100 characters, and an unknown token name; `radius` accepts `0.5rem` and rejects `5`; `fontFamily` accepts `inherit` and `"Inter", sans-serif` and rejects `a;b`. In `test/config.test.ts`: `defineConsent({...})` has `config.ui` equal to defaults, a custom `ui.banner.layout` survives `toPublicJson` → `fromPublicJson`, and a bad `ui` in the JSON throws `ConsentConfigError` with a path starting `ui.`.
- [ ] **Step 2: Run** `npx vitest run test/ui-settings.test.ts test/config.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/ui-settings.ts` as specified (reject unknown keys at every level; reuse `ConsentConfigError` from `src/validate.ts`; color pattern: hex `#[0-9a-fA-F]{3,8}`, or `rgb|rgba|hsl|hsla|oklch|oklab` followed by parentheses containing only `[0-9a-zA-Z.,%/ +-]`, or `var(--[a-z0-9-]{1,40})`; max 100 characters). Wire `resolveUi(input.ui, 'ui')` into `define()` in `src/config.ts` and deep-freeze with the rest. Export the types and `DEFAULT_UI` from `src/index.ts`.
- [ ] **Step 4: Run** the same command plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): modular ui settings with validation and defaults`.

### Task 2: Per-service state

**Files:**
- Modify: `src/schema.ts`, `src/state.ts`, `src/client.ts` (`isAllowed`)
- Test: `test/state.test.ts`, `test/client.test.ts`

**Interfaces:**
- Produces: `ConsentState.services: Record<string, string[]> | null` (category id → accepted service ids; `null` means the cookie has no `services` field); `export function serviceAccepted(state: ConsentState, service: ServiceEntry): boolean` in `src/state.ts`: true for `necessary`; otherwise the category is in `state.categories` and (`state.services === null` or `state.services[service.category]` includes `service.id`).

- [ ] **Step 1: Write failing tests** in `test/state.test.ts`: `parseConsent` reads `services` from the cookie JSON; entries that are not arrays of strings matching `^[a-z0-9-]{1,48}$` are dropped; `serviceAccepted` is true for a listed service of an accepted category, false for an unlisted one in the same category, false for a listed service whose category is not in `categories`, and, with `services: null` (old cookie), true for every service of an accepted category. In `test/client.test.ts` (fake driver): `isAllowed('openstreetmap')` true and `isAllowed('youtube')` false when only the first is listed; a service whose `catalogRevision` is higher than the stored revision stays not allowed even though its category and id are accepted.
- [ ] **Step 2: Run** `npx vitest run test/state.test.ts test/client.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the parse field and `serviceAccepted`; make `isAllowed` in `src/client.ts` use it after the existing revision checks. Before relying on the cookie shape, check it against the real engine: after `CC.acceptService`, the engine cookie's `services` field is an object keyed by category (see the types in `node_modules/vanilla-cookieconsent/types/index.d.ts`); if the real shape differs, change only the parsing.
- [ ] **Step 4: Run** the same command plus `npx vitest run test/driver-vcc-real.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(state): per-service consent state`.

### Task 3: Driver and client API

**Files:**
- Modify: `src/driver.ts`, `src/driver-vcc.ts` (`createVccDriver`), `src/client.ts`, `src/schema.ts` (`DecisionInfo`), `src/ui.ts` (embed button)
- Test: `test/client.test.ts`, `test/events.test.ts`, `test/driver-vcc-real.test.ts`, `test/state.test.ts`

**Interfaces:**
- `DecisionInfo`: `kind: 'first'|'change'|'reconfirm'|'withdraw'`, `changed: Category[]`, new `changedServices: string[]` and `locale: string` (the language the visitor saw), so that `onDecision(state, info)` carries everything a consent record needs: reference and time and policy version from `state`, language and kind and changes from `info`.
- `ConsentDriver.acceptServices(selection: Record<string, string[]>): void`: afterwards exactly these service ids are accepted per category; a category with an empty list is not accepted; necessary always is. Closes the banner and dialog like `decide` does.
- `DriverHooks.onChange(changed: Category[], changedServices: string[]): void`.
- `Consent.setServices(ids: string[]): void` (exact set of optional service ids; throws `[consent] unknown service <id>` for an unknown id; ids of necessary services are ignored), `Consent.acceptService(id: string): void` (adds one to the current set), `Consent.withdraw(): void`.

- [ ] **Step 1: Write failing tests.** `client.test.ts` with the fake driver: `setServices(['openstreetmap','youtube'])` calls `driver.acceptServices({media:['openstreetmap','youtube']})` and sets the other optional categories to empty lists; unknown id throws; `acceptService('youtube')` keeps already-accepted services; `withdraw()` calls `driver.rejectAll` and the resulting decision has `kind: 'withdraw'` and `changedServices` listing what was allowed before; a service that was turned off while its category stays accepted is unloaded (script node removed, its storage cleared, reported in `consent.leftovers` if it cannot be cleared). `events.test.ts`: `onDecision` receives `changedServices`. `driver-vcc-real.test.ts` with the real engine: `acceptServices({media:['openstreetmap']})` leaves the cookie's `services.media` equal to `['openstreetmap']`, fires one change, and `serviceAccepted` agrees. `state.test.ts` (Review Focus 3): select every service of the full shipped catalog plus 40 generated services in one category, build the stored cookie value the way the engine does, and assert `encodeURIComponent(JSON.stringify(cookie)).length < MAX_COOKIE_LENGTH`; if it does not fit, store service ids compactly and make `parseConsent` read that.
- [ ] **Step 2: Run** `npx vitest run test/client.test.ts test/events.test.ts test/driver-vcc-real.test.ts test/state.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Withdraw sets a one-shot flag before calling `driver.rejectAll()`; the `onChange` hook reads and clears it to choose `kind: 'withdraw'`. The `withdraw` helper in `createConsent` unloads every service that was allowed and no longer is, not only services of changed categories. In `src/ui.ts` the embed placeholder button with `data-consent-action="accept"` now calls `consent.acceptService(entry.id)`.
- [ ] **Step 4: Run** the Step 2 command plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(client): per-service API, withdraw decision kind`.

### Task 4: Engine configuration from `ui`

**Files:**
- Modify: `src/driver-vcc.ts` (`buildVccConfig`), `src/view.ts` (add `ui: UiSettings` to `View`)
- Test: `test/driver-vcc.test.ts`, `test/view.test.ts`

**Interfaces:**
- Consumes: `UiSettings` (Task 1), `DriverHooks.onChange` (Task 3).
- Produces: `buildVccConfig(view, hooks, secure)` reads `view.ui`.

- [ ] **Step 1: Write failing tests** in `test/driver-vcc.test.ts`: default config gives `guiOptions.consentModal` `{layout:'bar', position:'bottom', equalWeightButtons:true, flipButtons:false}` and `preferencesModal` `{layout:'box', position:'right', ...}`; a custom `ui.banner = {layout:'box', position:'bottom left', equalWeightButtons:false, flipButtons:true}` is passed through; every optional category with services has `categories[cat].services[id].label` equal to the escaped service title, with that service's cookie names in `cookies` for auto-clear; `ui.manager.serviceToggles:false` produces no `services` entries (group toggles only); the engine's `onChange` calls `hooks.onChange` with `changedCategories` and the flattened `changedServices`. `test/view.test.ts`: `buildView(...).ui` equals `config.ui`.
- [ ] **Step 2: Run** `npx vitest run test/driver-vcc.test.ts test/view.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the mapping; keep the existing escaping and the `onModalHide` decision logic. Use the engine's native dialog. If its per-service toggles cannot be made to go through the client API or be read back from it, you may replace the preferences dialog with a custom one that renders `renderSettings` (Task 8) in a modal; the behavior must stay identical to the panel.
- [ ] **Step 4: Run** the Step 2 command plus `npx vitest run test/driver-vcc-real.test.ts` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(banner): bottom bar default and per-service dialog from ui settings`.

### Task 5: New messages

**Files:**
- Modify: `src/messages.ts`, `src/locales/sk.ts`, `src/locales/fr.ts`, `src/locales/de.ts`, `src/astro/GatedEmbed.astro`
- Test: `test/messages.test.ts`, `test/locale-model.test.ts`, `test/exports.test.ts`

**Interfaces:**
- Produces new `Messages` keys with these English texts (placeholders in braces): `receiptTitle` "Your consent reference"; `receiptNone` "No choice saved yet."; `receiptCopy` "Copy"; `receiptCopied` "Copied"; `receiptSaved` "Saved"; `receiptPolicy` "Policy version"; `receiptLanguage` "Language"; `receiptChoice` "Choice"; `choiceAll` "All"; `choiceNecessary` "Necessary only"; `choiceCustom` "Custom"; `settingsTitle` "Cookie and privacy settings"; `settingsIntro` "Choose what you allow. Necessary items are always on. You can change or withdraw your choice at any time."; `settingsSaved` "Your choice has been saved."; `withdraw` "Withdraw consent"; `showDetails` "Show details"; `hideDetails` "Hide details"; `servicesAllowed` "{allowed} of {total} allowed"; `stateMixed` "Some allowed"; `noStorage` "No storage documented"; `embedAllow` "Allow {service}".
- `embedAccept` is removed and replaced by `embedAllow`; `GatedEmbed.astro` uses `format(m.embedAllow, { service: label })` for its accept button.

- [ ] **Step 1: Write failing tests:** `MESSAGE_KEYS` contains each new key and not `embedAccept`; each of sk, fr, de provides every new key (reuse the existing "every shipped pack covers every key" check in `test/messages.test.ts` or `locale-model.test.ts`); `{allowed}`/`{total}`/`{service}` placeholders survive in every language (assert with a regex per pack).
- [ ] **Step 2: Run** `npx vitest run test/messages.test.ts test/locale-model.test.ts test/exports.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** en, the three draft packs, and the `GatedEmbed.astro` change.
- [ ] **Step 4: Run** the Step 2 command plus `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(i18n): consent manager texts in en, sk, fr, de`.

### Task 6: Script setup in gating, and storage translation keys

**Files:**
- Modify: `src/schema.ts`, `src/validate.ts`, `src/gating.ts`, `src/i18n/resolve.ts`, `src/i18n/pack.ts`
- Test: `test/gating.test.ts`, `test/validate.test.ts`, `test/resolve.test.ts`, `test/csp.test.ts`

**Interfaces:**
- `export type ScriptInit = { kind: 'gtag'; id: string } | { kind: 'gtm' } | { kind: 'fbq'; id: string }`; `Gating` script variant becomes `{ type: 'script'; src: string; init?: ScriptInit }`.
- `StorageItem.translationKey?: string`: when present the resolver looks up pack storage translations by this key instead of `name` (needed for cookie names with a per-site part such as `_ga_ABC1234`). Same pattern as storage names.
- `export function runScriptInit(win: Window & typeof globalThis, init: ScriptInit): void` in `src/gating.ts`.

- [ ] **Step 1: Write failing tests.** `validate.test.ts`: `init` only allowed with `gating.type === 'script'`; `gtag` id must match `^G-[A-Z0-9]{4,20}$`, `fbq` id `^[0-9]{5,20}$`; unknown `kind` and unknown keys rejected; `translationKey` must match the storage name pattern. `gating.test.ts` (jsdom): `runScriptInit` for `gtag` creates `window.dataLayer` and a `window.gtag` that pushes the `arguments` object, then `gtag('js', Date)` and `gtag('config', id)` appear as the first two `dataLayer` entries, and `window['ga-disable-<id>']` is `false`; for `gtm` `dataLayer` gets `{ 'gtm.start': <number>, event: 'gtm.js' }`; for `fbq` `window.fbq` is a queueing stub that holds `['init', id]` then `['track','PageView']`; `loadScript` runs the setup once and a second call neither re-injects nor re-runs it; `unloadService` for a `gtag` entry sets `window['ga-disable-<id>']` to `true`; after all of this `document.querySelectorAll('script:not([src])').length` is 0. `resolve.test.ts`: a storage item with `translationKey` is translated from the pack key, not its name. `csp.test.ts`: script host still derived from `src`.
- [ ] **Step 2: Run** `npx vitest run test/gating.test.ts test/validate.test.ts test/resolve.test.ts test/csp.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The `fbq` stub follows Meta's standard loader semantics (queue calls until `fbevents.js` replaces it); `gtag` pushes `arguments`, not an array, because Google's loader only recognizes `Arguments` objects.
- [ ] **Step 4: Run** the Step 2 command plus `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(gating): declarative script setup for analytics and pixels`.

### Task 7: Analytics and marketing catalog entries

**Files:**
- Create: `src/catalog/google-analytics.ts`, `src/catalog/google-tag-manager.ts`, `src/catalog/meta-pixel.ts`
- Modify: `src/catalog/index.ts`, the three packs (translations), `admin/src/lib/catalog.ts` (add sample args to `SAMPLE_ARGS`)
- Test: `test/catalog.test.ts`, `test/admin-catalog.test.ts`

**Interfaces:**
- Consumes: `ScriptInit`, `translationKey` (Task 6).
- Produces:
  - `googleAnalytics(o: { measurementId: string; category?: Category }): ClientEntry`: id `google-analytics`, default category `analytics`, gating script `https://www.googletagmanager.com/gtag/js?id=<measurementId>` with `init {kind:'gtag', id}`, origins `www.googletagmanager.com`, csp `connect-src` `www.google-analytics.com`, `analytics.google.com`, `img-src` `www.google-analytics.com`, storage `_ga` (cookie, 2 years) and `_ga_<measurementId without "G-">` (cookie, 2 years, `translationKey: '_ga_container'`).
  - `googleTagManager(o: { containerId: string; category?: Category }): ClientEntry`: id `google-tag-manager`, default category `marketing`, containerId must match `^GTM-[A-Z0-9]{4,10}$`, script `https://www.googletagmanager.com/gtm.js?id=<containerId>` with `init {kind:'gtm'}`, storage empty, notes say tags inside the container are not gated individually by this library.
  - `metaPixel(o: { pixelId: string; category?: Category }): ClientEntry`: id `meta-pixel`, default category `marketing`, script `https://connect.facebook.net/en_US/fbevents.js` with `init {kind:'fbq', id}`, origins `connect.facebook.net`, csp `connect-src` and `img-src` `www.facebook.com`, storage `_fbp` (cookie, 90 days).
  - Each factory throws a plain error naming the option when its ID is missing or malformed. Catalog entry `catalogRevision: 1`, `lastVerified: null`, notes contain "UNVERIFIED" unless provider documentation is checked during this task and backs every fact (then set the date). The hosts above are from memory: check them against the providers' documentation and correct them before committing.

- [ ] **Step 1: Write failing tests** in `test/catalog.test.ts`: ids, default categories, category override, malformed IDs throw, `cspSources` for a config with all three includes the connect-src and img-src hosts above, every entry passes `validateService`, the expected-`lastVerified` map includes the three new ids, and the existing "each shipped pack translates every catalog service" test passes when the three are added to its service list (this needs the pack translations below; `googleAnalytics` is built with a sample ID in that list). `test/admin-catalog.test.ts`: `listCatalog()` includes the three entries without throwing.
- [ ] **Step 2: Run** `npx vitest run test/catalog.test.ts test/admin-catalog.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the entries, exports, sk/fr/de translations (title, description, storage `expiry`/`purpose` including the `_ga_container` key), and the admin sample args.
- [ ] **Step 4: Run** the Step 2 command, `npm run typecheck`, and `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(catalog): Google Analytics 4, Google Tag Manager, Meta Pixel`.

### Task 8: Settings panel model and HTML renderer

**Files:**
- Create: `src/settings.ts`
- Test: `test/settings.test.ts`

**Interfaces:**
- Consumes: `View` (with `ui`, Task 4), `ConsentState` (Task 2), new messages (Task 5), `escapeHtml` from `src/html.ts`.
- Produces:
  ```ts
  export type SwitchState = 'on' | 'off' | 'mixed'
  export function groupState(selected: ReadonlySet<string>, serviceIds: readonly string[]): SwitchState
  export function choiceSummary(allowed: ReadonlySet<string>, optionalIds: readonly string[]): 'all' | 'necessary' | 'custom'
  export function formatSaved(timestamp: string | null, locale: string): string   // Intl date and time; '—' for null or invalid
  export function renderSettings(view: View, state: ConsentState | null, allowed: ReadonlySet<string>): string
  ```
  `renderSettings` returns the panel markup with these classes and attributes (the contract the stylesheet and binder use): root `section.consent-settings[data-consent-settings]`; receipt `div.consent-receipt` containing `.consent-receipt__id`, `button.consent-btn.consent-btn--secondary[data-consent-action="copy"]`, `.consent-receipt__meta` (omitted when `ui.manager.receipt` is false; shows `receiptNone` when `state` is null); each category `div.consent-category[data-category]` with header `.consent-category__head` containing an `input.consent-switch[type=checkbox][role=switch][data-consent-group]`, labelled by the category title (`disabled` and checked for necessary); each service `div.consent-service[data-service]` with `input.consent-switch[data-consent-service]` (omitted when `ui.manager.serviceToggles` is false); storage `table.consent-table` (omitted when `ui.manager.storageTables` is false, `noStorage` text when empty); details wrapper `<details>` open when `ui.manager.details === 'open'`; actions `div.consent-actions` with buttons `data-consent-action="accept-all" | "reject-all" | "save" | "withdraw"` (withdraw omitted when `ui.manager.withdraw` is false); `div[aria-live="polite"].consent-status`; processor list omitted unless `ui.manager.processors`.

- [ ] **Step 1: Write failing tests** in `test/settings.test.ts`: `groupState` returns on/off/mixed for all/none/some; `choiceSummary` for the three outcomes; `formatSaved(null,'en')` and `formatSaved('garbage','en')` return `—`, a valid ISO timestamp returns a non-empty string; `renderSettings` with defaults parsed into a jsdom document contains one `[data-consent-group]` per optional category, a disabled checked switch for necessary, one `[data-consent-service]` per service, the consent ID text from `state.consentId` exactly as stored, no withdraw button when `ui.manager.withdraw` is false or when `allowed` is empty, no `[data-consent-service]` when `serviceToggles` is false, `<details open>` only when `details:'open'`, HTML in a service title is escaped, and with `state === null` it shows the `receiptNone` text and no reference.
- [ ] **Step 2: Run** `npx vitest run test/settings.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/settings.ts`. All strings come from `view.m` and the view; escape everything with `escapeHtml`; each switch has a real `<label>`; set `aria-checked` through the checkbox's own state and the mixed state through `aria-checked="mixed"` set by the binder (Task 9).
- [ ] **Step 4: Run** `npx vitest run test/settings.test.ts` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(settings): consent manager panel model and renderer`.

### Task 9: Panel binding and theme application

**Files:**
- Create: `src/panel.ts`
- Modify: `src/index.ts`
- Test: `test/panel.test.ts`

**Interfaces:**
- Consumes: `renderSettings` (Task 8), `Consent` API (Task 3), `ThemeToken` (Task 1).
- Produces:
  ```ts
  export function bindSettings(consent: Consent, root: HTMLElement): () => void   // idempotent per root; returns unbind
  export function bindSettingsFromDom(doc?: Document): void                        // finds [data-consent-settings] roots once the client exists; re-runs on 'astro:page-load'
  export function applyTheme(el: HTMLElement, tokens: Partial<Record<ThemeToken, string>>): void   // sets --consent-override-<kebab-name> with style.setProperty
  ```

- [ ] **Step 1: Write failing tests** in `test/panel.test.ts` (jsdom, fake driver, real `createConsent`): clicking a group switch sets all its service switches and clears the mixed state; toggling one service makes the group `aria-checked="mixed"` and `servicesAllowed` text update; Save calls `consent.setServices` with exactly the checked service ids and writes `settingsSaved` into the live region; Accept all and Reject all call the consent methods; Withdraw calls `consent.withdraw()` and is hidden when nothing optional is allowed; Copy writes the reference to `navigator.clipboard` and shows `receiptCopied`; a `decision` event from the banner re-renders the panel to the new state (Review Focus 5: before any decision the panel renders, shows no reference, Save creates the first decision); binding the same root twice, and dispatching `astro:page-load` twice, registers listeners once and a single click produces one decision (Review Focus 4); `applyTheme` sets `--consent-override-primary` through `style.setProperty` and nothing else on the element; calling it with an unsafe value is a no-op (values were validated in Task 1).
- [ ] **Step 2: Run** `npx vitest run test/panel.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with one delegated click and one change listener per root; re-render by calling `renderSettings` and replacing the root's children, keeping focus on the control that was used; unsubscribe from consent events in the returned function.
- [ ] **Step 4: Run** `npx vitest run test/panel.test.ts`, `npm test`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(panel): interactive consent manager with reference and theme overrides`.

### Task 10: Astro component and package surface

**Files:**
- Create: `src/astro/ConsentSettings.astro`
- Modify: `src/astro/ConsentBanner.astro`, `package.json` (`exports`: `./astro/ConsentSettings.astro`, `./consent.css`), `src/ui.ts` (`bootFromDom` also calls `bindSettingsFromDom` and `applyTheme` on the document root with `config.ui.theme.tokens`)
- Test: `test/astro-smoke.test.ts`, `test/exports.test.ts`, `test/ui.test.ts`

**Interfaces:**
- `ConsentSettings` props: `{ config: ConsentConfig; locale: Locale; class?: string }`. It validates with `assertValidatedConfig`, renders `renderSettings(buildView(config, locale), null, new Set())` through `set:html`, imports `./consent.css`, and works as a read-only list without JavaScript (the switches render disabled until the binder enables them).

- [ ] **Step 1: Write failing tests:** `exports.test.ts` lists the two new exports and `test/admin-package.test.ts` still passes; `ui.test.ts`: `bootFromDom` applies `ui.theme.tokens` to the document root and binds a `[data-consent-settings]` root present in the DOM; `astro-smoke.test.ts` (the built sample app): a page with `<ConsentSettings>` contains `data-consent-settings`, a `consent-receipt`, and the built CSS contains `.consent-settings`.
- [ ] **Step 2: Run** `npx vitest run test/exports.test.ts test/ui.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the component, the exports and the boot wiring; add `<ConsentSettings>` to the Astro smoke test's sample page.
- [ ] **Step 4: Run** `npm test`, `npm run test:astro`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(astro): ConsentSettings component and package exports`.

### Task 11: Stylesheet

**Files:**
- Create: `src/astro/consent.css`
- Modify: `src/astro/ConsentBanner.astro`, `ConsentPreferences.astro`, `GatedEmbed.astro`, `ConsentReopen.astro`, `ProcessorList.astro` (each imports `./consent.css`; buttons and tables get the `consent-btn`, `consent-btn--primary|secondary`, `consent-table` classes)
- Test: `test/consent-css.test.ts`

**Interfaces:**
- Class contract: `consent-settings`, `consent-receipt` (`__id`, `__meta`), `consent-category` (`__head`), `consent-service`, `consent-switch`, `consent-table`, `consent-actions`, `consent-status`, `consent-btn`, `consent-btn--primary`, `consent-btn--secondary`, `consent-placeholder`, `consent-processors`, `consent-preferences`.
- CSS structure: first line `@layer theme, base, components, utilities;` so ordering is right whether this file loads before or after Tailwind (components sit above Tailwind's preflight and below its utilities, so a site can still override with utilities). All `.consent-*` rules live in `@layer components`. The engine variable mapping on `#cc-main` and `#cc-main.cc--darkmode` is unlayered, because the engine's own rules are unlayered and a layered rule would lose. Variable names come from `node_modules/vanilla-cookieconsent/dist/cookieconsent.css`.
- Token mapping, declared on each component root (not on `:root`) so local tokens are honored: `--consent-bg: var(--consent-override-background, var(--background, #ffffff))`, and the same pattern for foreground (`#111827`), primary (`#1f2937`), primary-foreground (`#ffffff`), muted (`#f3f4f6`), muted-foreground (`#4b5563`), border (`#d1d5db`), ring (`#2563eb`), radius (`0.5rem`), and `font-family: inherit`. Under `.dark` the fallbacks switch to dark neutrals. Reject and Settings buttons are outlined with the same size, weight and padding as Accept (equal prominence).

- [ ] **Step 1: Write failing tests** in `test/consent-css.test.ts` reading the file: starts with the layer-order statement; every `var(--background|--foreground|--primary|--primary-foreground|--muted|--muted-foreground|--border|--ring` use has a comma fallback; no physical `margin-left|margin-right|padding-left|padding-right|left:|right:|text-align: *left|text-align: *right` in the `.consent-*` rules (RTL, use logical properties); it contains `#cc-main.cc--darkmode`; a `.dark` block with fallbacks exists; every class in the class contract appears; no `@tailwind` or `@apply`.
- [ ] **Step 2: Run** `npx vitest run test/consent-css.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the stylesheet and the component class changes.
- [ ] **Step 4: Run** `npm test`, `npm run test:astro`. Expected: PASS. (The by-eye check of light, dark and no-token views happens in Task 12, once the admin page exists.)
- [ ] **Step 5: Commit** `feat(style): themed stylesheet that reads the site's color tokens`.

### Task 12: Admin preview

**Files:**
- Create: `admin/src/pages/manager.astro`
- Modify: `admin/src/layouts/Admin.astro` (nav link)
- Test: `test/admin-smoke.test.ts`

**Interfaces:**
- `/manager?tokens=light|dark|none&banner=bar|box|cloud` renders `ConsentBanner`, `ConsentSettings`, `ProcessorList` and a `GatedEmbed` with the playground's default config. `tokens=light|dark` injects the Archibald Knox token sets (light: background `#ffffff`, primary `#193637`, primary-foreground `#ffffff`; dark: background `#0f1616`, primary `#86c5c6`, primary-foreground `#0f1616`) on `html` (with the `dark` class for dark); `none` defines no tokens. The `banner` query overrides `ui.banner.layout` to show that settings drive the result. The page is local-only and view-only like the rest of the admin.

- [ ] **Step 1: Write failing tests** in `test/admin-smoke.test.ts` following its existing pattern: GET `/manager?tokens=none` returns 200 and contains `data-consent-settings`; `tokens=dark` response contains the `dark` class on `html`; an invalid `tokens` value falls back to `none`.
- [ ] **Step 2: Run** `npm run test:admin`. Expected: FAIL.
- [ ] **Step 3: Implement** the page (reads `Astro.url.searchParams`, `export const prerender = false`).
- [ ] **Step 4: Run** `npm run test:admin`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(admin): consent manager preview with token sets`.

### Task 13: Docs and full verification

**Files:**
- Modify: `README.md`
- Test: all suites

- [ ] **Step 1: Document** in `README.md`: the `ui` settings table with defaults, the `ConsentSettings` component and where to place it, the color tokens and fallbacks, theme overrides, the per-service API (`setServices`, `acceptService`, `withdraw`), the consent reference, the new `DecisionInfo` fields as the consent-record payload, and the analytics and marketing entries with their ID options.
- [ ] **Step 2: Run** `npm run typecheck && npm test && npm run test:astro && npm run test:admin`. Expected: all PASS.
- [ ] **Step 3: Commit** `docs: consent manager, ui settings and new catalog entries`.
