# Local admin view — design

Date: 2026-10-18 · Status: draft for review

## Why

cloveconsent is a library installed into other sites. The defaults it ships — the catalog of services and
processors, the English banner texts, and the sk/fr/de language packs — live in hand-written TypeScript spread
over `src/catalog/`, `src/messages.ts` and `src/locales/`. There is no single place to see all of it, spot gaps
(missing or unreviewed translations, unverified catalog entries), or try a combination and look at the real
banner. The admin view fills that gap for people developing the library.

## Goals

- **See everything** shipped as a default, in one local page with three tabs:
  1. **Catalog** — table of every catalog service and processor.
  2. **Languages** — every text × every language, with gaps highlighted.
  3. **Playground** — compose a config in the browser and see the real banner/preferences render.
- **Live with the source**: it reads `src/` directly, so editing a catalog or locale file and saving updates the
  page (dev-server reload). No build step of the library needed.
- One command to run it: `npm run admin`.

## Non-goals

- Editing or saving anything from the UI. **All changes to defaults are made in code.** The admin never writes
  to the repo.
- Writing or exporting a site's `consent.config.ts`.
- Hosting, auth, multi-user anything. It runs on localhost only.
- Use by sites that install cloveconsent.

## Anti-goals (failure even if it works)

- Any admin code, dependency or asset ends up in the published package (`files` in `package.json`, `tsup`
  entries, `exports`), or in a site's build.
- The Playground preview diverges from what a real site renders (a re-implemented look-alike banner).
- The admin keeps its own copy of catalog/locale data that can drift from `src/`.

## Constraints and existing facts

- Catalog entries are factory functions exported from `src/catalog/index.ts`: `turnstile`, `youtube`, `theme`,
  `resend`, `cloudflareCdn`, `facebookGraph`, `hosting`. Some take options (`youtube({ category })`;
  `hosting({ name, privacyUrl, location })` has required options).
- Entry shapes are in `src/schema.ts` (`ClientEntry`, `FirstPartyEntry`, `ProcessorEntry`): category, provider,
  storage items (name/type/expiry/purpose), gating, origins, csp extras, messages, `lastVerified`, `notes`,
  `catalogRevision`.
- Banner texts: `en` and `MESSAGE_KEYS` in `src/messages.ts`. Packs: `LocalePack` in `src/i18n/pack.ts`
  (`locale`, `reviewed`, `messages`, `catalog` keyed by entry id with title/description/purpose/location/
  transfers/dataCategories/storage).
- `defineConsent` (`src/config.ts`) is the validator: throws `ConsentConfigError` (e.g. missing translations
  unless `allowFallback`), computes `unreviewed`, and logs dev warnings via `console.warn`.
- Astro components in `src/astro/` (`ConsentBanner`, `ConsentPreferences`, `GatedEmbed`, `ProcessorList`,
  `ConsentReopen`) render a validated config; the banner boots client-side from embedded JSON
  (`toPublicJson` → `bootFromDom`).
- `fixtures/astro-site/astro.config.mjs` already shows how to point an Astro app at `src/` via Vite aliases for
  `cloveconsent`, `cloveconsent/catalog`, `cloveconsent/locales`. Reuse that pattern.
- Astro 7 is already a devDependency. Windows dev machine.

## Decided

- **Shape: tabs** (Catalog · Languages · Playground), chosen by the user over a single form+preview screen.
- **View only.** No writes from the UI (user).
- **Playground state is browser-only** and saves nothing (user agreed).
- Local only, never published (user).

### Catalog tab

- One row per entry: id, kind (client / first-party / processor), category, provider, storage count, gating
  type, origins, `lastVerified` (empty = unverified, visibly flagged), `catalogRevision`.
- Clicking a row shows the full entry: all fields, storage items table, CSP extras, `notes` (shown prominently —
  they hold the "UNVERIFIED" caveats), and which languages translate it.
- Entries with required options (`hosting`) are shown with clearly labelled sample arguments.

### Languages tab

- Rows: every banner message key, then every catalog entry's translatable texts (title, description, purpose,
  location, transfers, data categories, storage expiry/purpose).
- Columns: en (source), then each pack in `src/locales/`. Pack header shows `reviewed: true/false`.
- Cells: the text; missing translations highlighted; unreviewed packs visibly marked.
- Filter: "only show gaps".

### Playground tab

- Controls: enabled locales + default locale, services and processors (from the catalog, with their options
  where they take any), revision, darkMode, privacyHref, allowFallback; preview locale; light/dark; RTL check
  (via a right-to-left locale if one is available, otherwise as the builder sees fit).
- The config is run through the real `defineConsent`. Errors (`ConsentConfigError`) and dev warnings are shown
  in the page the way a build would report them.
- Preview uses the real components/boot path, not a copy. Shows banner and preferences panel; a "reset
  consent" action clears stored consent so the banner reappears.

## Settled during review (Claude's calls, not the user's)

- **Packs in the Playground:** all shipped packs (sk/fr/de) are passed to `defineConsent` by default; a toggle
  to leave one out (to see the "missing translations" error) is a nice-to-have.
- **RTL:** no RTL pack exists, so the RTL check uses an RTL locale (e.g. `ar`) with `allowFallback` on —
  English text in right-to-left layout — clearly labelled as such.
- **Live preview:** the banner boots once from `#consent-config`, so the preview reloads (page or iframe) on
  each change.
- **Gaps:** a key missing from a pack is a gap; pack entries whose id is not in the catalog are also listed
  (stale translations). "Unreviewed" is per pack, since `reviewed` is a pack-level flag.
- **`hosting`:** its English texts come from sample arguments; labelled as samples in Catalog and Languages.
- **Dependencies:** any the admin needs go in root `devDependencies` or the admin's own `package.json`; neither
  reaches the published package (`files` is `dist` + `src/astro`).

## Left to the builder

- Where the admin lives (suggested `admin/`, its own Astro app like the fixtures) and how `npm run admin` starts
  it.
- How the Playground re-renders on change (e.g. Astro on-demand rendering with the config in the query string,
  or booting client-side from `toPublicJson`), as long as the real validation and real banner code are used.
- How catalog entries are enumerated (from the `src/catalog/index.ts` exports).
- Styling: plain and readable; no design system needed.
- Tests: light — at minimum a check that the admin is not in the published package, and that each tab renders
  against the current `src/`.
