# Local Admin View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local, view-only Astro app (`npm run admin`) with three tabs — Catalog, Languages, Playground — that reads cloveconsent's defaults straight from `src/`.

**Architecture:** `admin/` is its own Astro app, wired to `src/` with the same Vite aliases as `fixtures/astro-site`. All logic lives in small pure TS modules in `admin/src/lib/` (unit-tested with vitest from `test/`); the `.astro` pages only render their results. The Playground keeps its state in the URL query string; pages that read it set `export const prerender = false` (verified: in `astro dev` this passes query params through with no adapter; static pages get them stripped). The preview is a separate page, shown in an iframe, that renders the real `src/astro` components.

**Tech Stack:** Astro 7.3.8 (existing devDependency), TypeScript, vitest + jsdom (existing). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-18-local-admin-design.md`

## Global Constraints

- View only: nothing in `admin/` writes to the repo or any file.
- Nothing from `admin/` may enter the published package: `package.json` `files` stays `["dist", "src/astro"]`; no `tsup` entry or `exports` key for admin.
- No copy of catalog/locale data in `admin/`: everything is read from `src/catalog/index.ts`, `src/messages.ts`, `src/locales/*.ts` at request time.
- The preview uses the real `defineConsent` and the real `src/astro/*.astro` components — no look-alike markup.
- No new dependencies. Only run with `astro dev`; `astro build` of `admin/` is not supported (no adapter) and not needed.
- Match repo style: no semicolons, single quotes, 2-space indent, terse comments.

## Review Focus

1. **A catalog factory that throws** (e.g. a new export with required options missing from `SAMPLE_ARGS`) → that row shows the error; the rest of the Catalog page still renders. Test in Task 2.
2. **A broken language pack** (fails `validatePack`) → Languages shows the pack's error in its column header; other packs still render. Test in Task 3.
3. **Garbage Playground query** (unknown entry name, `defaultLocale` not in `locales`, `revision=abc`, bad JSON in options) → a clear error message, no preview, page still usable. Test in Task 4.
4. **Stale stored consent hides the banner** after the first click in the preview → a "Reset consent" button deletes the consent cookie and reloads. Smoke-tested in Task 4.
5. **A new catalog export or a new locale file appears automatically** without touching `admin/` → `listCatalog` enumerates the module's exports; `loadPacks` globs `src/locales/*.ts`. Tests in Tasks 2 and 3.

---

### Task 1: Admin app skeleton, tab layout, package guard, smoke test

**Files:**
- Create: `admin/package.json`, `admin/astro.config.mjs`, `admin/src/layouts/Admin.astro`, `admin/src/pages/index.astro`, `admin/src/pages/languages.astro`, `admin/src/pages/playground.astro` (placeholders: heading only)
- Create: `test/admin-package.test.ts`, `test/admin-smoke.test.ts`
- Modify: `package.json` (scripts), `.gitignore`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `Admin.astro` layout with props `{ title: string; tab: 'catalog' | 'languages' | 'playground' }` rendering a nav (`Catalog` → `/`, `Languages` → `/languages`, `Playground` → `/playground`; active tab has `aria-current="page"`) and a `<slot />`. Plain inline `<style>`, readable, no design system.
- Produces: `test/admin-smoke.test.ts` helper pattern — `beforeAll` spawns `node node_modules/astro/bin/astro.mjs dev --root admin --port 4390`, polls `http://localhost:4390/` until 200 (timeout 60 s), `afterAll` kills it; `get(path): Promise<string>`. Later tasks add tests to this file.

- [ ] **Step 1: Write `test/admin-package.test.ts`**
  Test `admin is not in the published package`: run `npm pack --dry-run --json` (spawnSync, `shell: true` for Windows), parse, assert no file path starts with `admin/`; assert `pkg.files` equals `['dist', 'src/astro']`.
- [ ] **Step 2: Write `test/admin-smoke.test.ts`** with tests: `/`, `/languages`, `/playground` each return 200 and contain `aria-current="page"` and the three tab labels.
- [ ] **Step 3: Run `npx vitest run test/admin-smoke.test.ts`** — expected FAIL (no `admin/`).
- [ ] **Step 4: Create the admin app.** `admin/package.json`: `{ "name": "cloveconsent-admin", "private": true, "type": "module" }`. `admin/astro.config.mjs`: copy `fixtures/astro-site/astro.config.mjs` (aliases `cloveconsent/catalog`, `cloveconsent/locales`, `cloveconsent` → `../src/...`; note the path is one level up, not two) and set `server: { port: 4321 }`. Layout + three placeholder pages.
- [ ] **Step 5: Scripts.** In root `package.json`: `"admin": "astro dev --root admin"`, `"test": "vitest run --exclude test/astro-smoke.test.ts --exclude test/admin-smoke.test.ts"`, `"test:admin": "vitest run test/admin-smoke.test.ts"`. `.gitignore`: add `admin/.astro` and `admin/dist`. CI: add `- run: npm run test:admin` after `test:astro`.
- [ ] **Step 6: Run** `npm run test:admin` and `npx vitest run test/admin-package.test.ts` — expected PASS. Run `npm test` and `npm run typecheck` — expected PASS (unchanged).
- [ ] **Step 7: Manually run `npm run admin`**, open http://localhost:4321, click the three tabs.
- [ ] **Step 8: Commit** `feat(admin): local admin app skeleton with tabs`.

### Task 2: Catalog tab

**Files:**
- Create: `admin/src/lib/catalog.ts`, `test/admin-catalog.test.ts`
- Modify: `admin/src/pages/index.astro`, `test/admin-smoke.test.ts`

**Interfaces:**
- Produces (in `admin/src/lib/catalog.ts`, importing `../../../src/catalog/index` and types from `../../../src/schema` by relative path, not the alias, so vitest/tsc work without config):
  ```ts
  export type Entry = ServiceEntry | ProcessorEntry
  export const SAMPLE_ARGS: Record<string, unknown> = {
    hosting: { name: 'Example Host (sample)', privacyUrl: 'https://example.com/privacy', location: { en: 'Sample location' } },
  }
  export interface CatalogItem {
    name: string                 // export name, e.g. 'cloudflareCdn' — the stable key used everywhere in admin
    sample: boolean              // true when built from SAMPLE_ARGS
    entry: Entry | null
    error: string | null         // message of whatever the factory threw
    create(args?: unknown): Entry
  }
  export function listCatalog(mod?: Record<string, unknown>): CatalogItem[]   // default: the catalog module; only function exports; sorted by name
  ```

- [ ] **Step 1: Write `test/admin-catalog.test.ts`:**
  - `lists every catalog export`: `listCatalog().map(i => i.name)` equals `Object.keys(await import('../src/catalog/index')).filter(fn).sort()`.
  - `hosting is built from sample args`: item `hosting` has `sample: true`, `entry.provider.name === 'Example Host (sample)'`; item `youtube` has `sample: false`, `entry.id === 'youtube'`.
  - `a throwing factory becomes an error row`: `listCatalog({ ok: () => cloudflareCdn(), bad: () => { throw new Error('boom') } })` → `bad` has `entry: null`, `error: 'boom'`; `ok` has an entry.
- [ ] **Step 2: Run** `npx vitest run test/admin-catalog.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement `listCatalog`** as specified.
- [ ] **Step 4: Run** — PASS. `npm run typecheck` — PASS.
- [ ] **Step 5: Catalog page.** `index.astro` renders a table, one row per item: name, id, kind, category (processors: `—`), provider, storage count, gating type, origins, `lastVerified` (null → a visible "unverified" badge), `catalogRevision`, "sample args" badge when `sample`. Error rows show the error in a red cell spanning the row. Each row expands (`<details>` in the first cell or a following row) to the full entry: storage table (name/type/expiry.en/purpose.en), gating incl. sandbox/src, CSP extras, English messages/purpose/location/transfers/dataCategories, `dpaUrl`, and `notes` in a highlighted box. (The "translated in" line is added in Task 3.)
- [ ] **Step 6: Smoke test** (add to `admin-smoke.test.ts`): `/` contains `cloudflare-turnstile`, `cloudflare-cdn`, `Example Host (sample)` and `UNVERIFIED` (youtube's notes). Run `npm run test:admin` — PASS.
- [ ] **Step 7: Commit** `feat(admin): catalog tab`.

### Task 3: Languages tab

**Files:**
- Create: `admin/src/lib/languages.ts`, `test/admin-languages.test.ts`
- Modify: `admin/src/pages/languages.astro`, `admin/src/pages/index.astro` (translated-in column), `test/admin-smoke.test.ts`

**Interfaces:**
- Consumes: `Entry`, `listCatalog` from Task 2.
- Produces (`admin/src/lib/languages.ts`, with `/// <reference types="vite/client" />` for `import.meta.glob`; confirm `vite/client` resolves from root `node_modules`, else declare the one `glob` signature locally):
  ```ts
  export interface PackInfo { file: string; pack: LocalePack | null; error: string | null }
  export function loadPacks(mods?: Record<string, unknown>): PackInfo[]
  // default mods: import.meta.glob('../../../src/locales/*.ts', { eager: true }); each module's `default` is passed to validatePack(value, file); sorted by locale/file
  export interface TextRow { group: string; key: string; en: string; translations: Record<string, string | null> }
  export function textGrid(entries: Entry[], packs: LocalePack[]): TextRow[]
  export function orphanTranslations(entries: Entry[], packs: LocalePack[]): { locale: string; id: string }[]
  ```
- `textGrid` row order and keys: group `banner`, one row per `MESSAGE_KEYS` key (en from `englishMessages`, translation from `pack.messages[key]`). Then per entry, group = entry id: client/first-party → `title`, `description`, `storage.<name>.expiry`, `storage.<name>.purpose`; processor → `purpose`, `location`, `transfers` (only if the entry has it), `dataCategories.<i>`. `en` is the entry's `.en`; translation from `pack.catalog[id]` at the matching `EntryTranslation` field (`storage[name].expiry`, `dataCategories[i]`). Missing → `null`. The `translations` keys are pack locales.

- [ ] **Step 1: Write `test/admin-languages.test.ts`:**
  - `loads every shipped pack`: `loadPacks().map(p => p.pack?.locale)` equals `['de', 'fr', 'sk']`, all `error: null`.
  - `a broken pack is reported, not thrown`: `loadPacks({ 'x.ts': { default: { locale: 'xx', reviewed: 'no' } } })` → one item, `pack: null`, `error` contains `reviewed`.
  - `banner rows come first with sk text`: grid row `{ group: 'banner', key: 'bannerTitle' }` has `en: 'We use cookies'`, `translations.sk: 'Používame cookies'`.
  - `missing translation is null`: with a pack `{ locale: 'sk', reviewed: false, messages: {}, catalog: {} }`, every row's `translations.sk` is `null`.
  - `processor fields and indices`: for `cloudflareCdn()` rows include keys `purpose`, `location`, `dataCategories.0`, `dataCategories.1` and no `transfers`.
  - `orphans`: a pack with `catalog: { ghost: { title: 'x' } }` → `[{ locale, id: 'ghost' }]`.
- [ ] **Step 2: Run** `npx vitest run test/admin-languages.test.ts` — FAIL.
- [ ] **Step 3: Implement** the three functions.
- [ ] **Step 4: Run** — PASS. `npm run typecheck` — PASS.
- [ ] **Step 5: Languages page.** Column headers: `en (source)`, then each pack's locale with `reviewed`/`unreviewed` badge; a pack with `error` gets a header cell showing the error and empty column. Rows grouped by `group` with a group heading row (`hosting` group labelled "sample args"). `null` cells highlighted as missing. A "Show only gaps" checkbox hides rows with no `null` (tiny inline script toggling a class). An "Orphan translations" list below the table when non-empty. In `index.astro`'s expanded entry, add "Translated in: sk, de…" using `textGrid` rows of that id (a locale counts if all its rows are non-null; otherwise "partial").
- [ ] **Step 6: Smoke test:** `/languages` contains `bannerTitle`, `Používame cookies`, `unreviewed`. PASS.
- [ ] **Step 7: Commit** `feat(admin): languages tab`.

### Task 4: Playground tab and preview

**Files:**
- Create: `admin/src/lib/playground.ts`, `admin/src/pages/preview.astro`, `test/admin-playground.test.ts`
- Modify: `admin/src/pages/playground.astro`, `test/admin-smoke.test.ts`

**Interfaces:**
- Consumes: `CatalogItem`, `listCatalog` (Task 2); `loadPacks` (Task 3).
- Produces (`admin/src/lib/playground.ts`):
  ```ts
  export interface PlaygroundState {
    locales: string[]; defaultLocale: string; previewLocale: string
    services: string[]; processors: string[]        // CatalogItem.name values
    args: Record<string, string>                     // name → JSON text passed to create(); absent → SAMPLE_ARGS or no args
    revision: string                                 // kept as text so bad input reaches validation
    darkMode: boolean; privacyHref: string; allowFallback: boolean
    theme: 'light' | 'dark'
  }
  export const DEFAULT_STATE: PlaygroundState   // locales ['en','sk'], defaultLocale 'en', previewLocale 'en', services ['turnstile','theme','youtube'], processors ['cloudflareCdn'], args {}, revision '1', darkMode true, privacyHref '', allowFallback false, theme 'light'
  export function parseState(q: URLSearchParams): PlaygroundState   // empty query → DEFAULT_STATE; repeated params for arrays (locales=en&locales=sk); args as `args.<name>=<json>`; booleans '1'/'0'; marker param `s=1` means "form was submitted", so unchecked boxes mean false/empty rather than default
  export function toQuery(s: PlaygroundState): string                // inverse of parseState, includes s=1
  export interface BuildResult { config: ConsentConfig | null; error: string | null; warnings: string[] }
  export function buildConfig(s: PlaygroundState, catalog: CatalogItem[], packs: LocalePack[]): BuildResult
  ```
- `buildConfig`: unknown name → error `unknown catalog entry: <name>`; bad JSON in `args` → error `options for <name> are not valid JSON`; `revision` not an integer string → error `revision must be a whole number`; `previewLocale` not in `locales` → error `preview language must be one of the enabled languages`. Otherwise call `defineConsent({ locales, defaultLocale, revision, darkMode, privacyHref: privacyHref || undefined, allowFallback, services, processors, packs })` — services are items whose entry kind is client/first-party, processors kind processor (a name in the wrong list → error `<name> is a processor` / `is a service`). Any thrown error → `error: e.message`. Capture `console.warn` calls made during `defineConsent` into `warnings` (restore it in `finally`).

- [ ] **Step 1: Write `test/admin-playground.test.ts`:**
  - `round-trips state`: `parseState(new URLSearchParams(toQuery(s)))` deep-equals `s` for `DEFAULT_STATE` and for a state with `args: { hosting: '{"name":"H","privacyUrl":"https://h.example","location":{"en":"EU"}}' }` and `theme: 'dark'`.
  - `empty query is the default`: `parseState(new URLSearchParams(''))` equals `DEFAULT_STATE`.
  - `default state builds`: `buildConfig(DEFAULT_STATE, listCatalog(), packs)` → `error: null`, `config.services.map(s => s.id)` equals `['cloudflare-turnstile', 'theme', 'youtube']`.
  - `garbage is reported`: one test per error message above (`services: ['nope']`, `args: { hosting: '{' }`, `revision: 'abc'`, `previewLocale: 'fr'` with locales `['en']`, `defaultLocale: 'de'` with locales `['en']` → the `ConsentConfigError` message), each `config: null`.
  - `missing pack + allowFallback`: locales `['en','ar']`, previewLocale `ar`, allowFallback true → `error: null`, `warnings` has an entry containing `missing translations`; same with allowFallback false → `error` contains `missing translations`.
- [ ] **Step 2: Run** `npx vitest run test/admin-playground.test.ts` — FAIL.
- [ ] **Step 3: Implement** `parseState`, `toQuery`, `buildConfig`.
- [ ] **Step 4: Run** — PASS. `npm run typecheck` — PASS.
- [ ] **Step 5: `preview.astro`** (`export const prerender = false`): parse `Astro.url.searchParams`, `buildConfig`. On error, render a minimal page with the error in a `<pre>`. Otherwise render a full `<html lang={previewLocale} class={theme === 'dark' ? 'dark' : undefined}>` with `ConsentBanner`, `ConsentPreferences`, `ProcessorList`, `ConsentReopen` (imported from `../../../src/astro/`, props `config`, `locale = previewLocale`), and a fixed "Reset consent" button whose inline script deletes the `config.cookieName` cookie (`Max-Age=0; path=/`) and reloads. (`dir` comes from the components/driver via `view.dir`; do not set it by hand. If the banner does not show RTL for `ar`, note it — it's a library finding, not something to patch here.)
- [ ] **Step 6: `playground.astro`** (`export const prerender = false`): a GET form with hidden `s=1`, built from `listCatalog()` and `loadPacks()`:
  - Languages: checkbox per `en` + each pack locale + `ar` labelled "ar (right-to-left test — needs allowFallback, shows English)"; selects for default and preview language from enabled ones.
  - Services and processors: checkbox per catalog item of that kind (label: name + id), with a text input `args.<name>` for items that are `sample` or take options (prefill with `JSON.stringify(SAMPLE_ARGS[name])` when present).
  - revision, privacyHref, darkMode, allowFallback, theme (light/dark radio).
  - Inline script: any `change` → `form.requestSubmit()`.
  - Below: the error (red) and warnings (amber) from `buildConfig`, then `<iframe src={'/preview?' + toQuery(state)}>` sized ~ 100% × 700px.
- [ ] **Step 7: Smoke tests:** `/playground` contains `<iframe` and `cloudflareCdn`; `/preview` (empty query) contains `id="consent-config"` and `Reset consent`; `/preview?s=1&services=nope&locales=en&defaultLocale=en&previewLocale=en&revision=1` contains `unknown catalog entry: nope`; `/preview?<toQuery({ ...DEFAULT_STATE, theme: 'dark' })>` contains `class="dark"`. PASS.
- [ ] **Step 8: Manual check:** `npm run admin` → Playground: toggle a service, the preview reloads; switch preview to `sk`; accept all, then "Reset consent" brings the banner back; dark theme; `ar` + allowFallback.
- [ ] **Step 9: Full verification:** `npm run typecheck`, `npm test`, `npm run test:astro`, `npm run test:admin` — all PASS.
- [ ] **Step 10: Commit** `feat(admin): playground tab with live preview`.
