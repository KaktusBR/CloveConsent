# Consent manager core: per-service consent, privacy-page manager, themed UI

Date: 2026-11-09. Status: draft for approval.

## Intent

cloveconsent is a TypeScript consent library installed into the author's sites (Astro, Tailwind, shadcn-style color tokens). Today consent is stored per category only, the banner uses vanilla-cookieconsent's stock look, and there is no page where a visitor can review and change their choices. The author wants a solid consent preference manager, not a half-built banner: every service can be switched on or off individually and as a group, a standard privacy-page view shows the visitor their choices and a unique consent reference, and everything looks like part of the site with no setup.

## The end goal: a hosted CMP

The overall goal is a proper hosted consent management platform at cmp.clovetek.com, run by the author. It has its own admin UI where each site (tenant) is configured: services, texts, languages, policy version, colors. Each site embeds one snippet that loads the banner and manager from the CMP and receives that site's config. The CMP stores consent records so consent can be demonstrated, and visitors keep their reference number and can review their choices on the site's privacy page. Whether it serves only the author's sites or other companies too is still open and belongs to the hosted-service design.

The author wants all of it, as one project built in two phases, in this order:

- **Phase 1 (this document): the consent manager core.** The visitor-facing runtime and UI: per-service consent, the settings panel, the consent reference, the themed bottom-bar banner, analytics and marketing entries. This is what the hosted CMP serves to every site.
- **Phase 2: the hosted service.** Embed loader, tenant and site config API, admin UI (the current local admin is its seed), consent record storage, authentication, and the legal side of the CMP processing visitors' data. It gets its own detailed design document, written after this one and before it is built, because its stack, hosting and tenancy are still undecided.

Part 1 must be built so part 2 needs no rework: the client keeps booting from the public JSON config it already uses (never assume config lives in code only), the stylesheet and theming must be reachable by a loader script, `onDecision` carries everything a consent record needs (reference, time, policy version, language, accepted services, decision kind), and nothing in the runtime depends on the host being an Astro site.

## Goals

1. **Per-service consent with group control.** A visitor can allow or refuse each service individually. A group (category) toggle switches all of its services together and shows a mixed state when its services differ. Necessary is always on and locked.
2. **An embeddable settings panel** for a privacy/cookie page, shipped as an Astro component. It shows the visitor's real current state, lets them change it, and stays in sync if they change it elsewhere (banner, settings dialog, another tab is optional).
3. **A consent receipt** at the top of that panel: the unique consent reference (copyable), when the choice was saved, the policy version (`revision`), the language, and a summary (all / necessary only / custom). Before any decision it says no choice is saved yet.
4. **Actions on the panel:** Accept all, Reject all, Save selection, Withdraw consent. Withdrawing is as easy as giving consent.
5. **Bottom-bar banner** with equal-weight Accept, Reject and Settings buttons. Settings opens the dialog with the same per-service toggles.
6. **Plug and play look.** One shipped stylesheet themes the banner, dialog, panel, tables, buttons, blocked-embed placeholder, processor list and reopen button. It reads the host site's color tokens and needs no Tailwind configuration.
7. **Analytics and marketing are first-class.** The categories exist already; this work adds first catalog entries for them so the manager is not empty in those groups.
8. **Verification vehicle:** the local admin previews the banner and the panel under light, dark and no-token color sets.

## Non-goals

- Phase 2 items (the hosted CMP, tenant admin, auth, server-side storage of consent records) are a goal of the project but not of this document. In phase 1 the library only reports decisions through the existing `onDecision` hook and sends nothing anywhere.
- IAB TCF, Google Consent Mode, per-vendor legitimate-interest toggles.
- Editing configuration from the local admin. It stays view-only.
- A Tailwind plugin or utility classes shipped inside the library.

## Anti-goals (a failure even if it technically works)

- A toggle that looks on while the service is blocked, or the reverse.
- The panel, banner and dialog disagreeing about the current choice.
- Colors that only work when the host adds the library to Tailwind's content scanning, or that ignore dark mode.
- A visitor who cannot tell what they agreed to, when, or under which reference.
- Reject being less prominent than Accept.

## Decisions made by the author

- Banner: full-width bottom bar.
- Colors: the author's sites all use the same shadcn-style tokens (`--background`, `--foreground`, `--primary`, `--primary-foreground`, `--muted`, `--muted-foreground`, `--border`, `--ring`) and toggle dark mode with a `.dark` class on `html`. Tokens that are missing fall back to neutral built-in colors.
- Styling is plain CSS with stable class names, not Tailwind utilities, so it works without Tailwind setup and can still be overridden with the site's own utilities or CSS.
- Per-service and per-group control, both.
- A privacy-page view with a unique consent reference is required.
- Analytics and marketing are part of it.

## Existing code this builds on (verified)

- vanilla-cookieconsent 3.1.0 is the banner/dialog engine and already stores a `consentId` and `lastConsentTimestamp`, which `parseConsent` already reads (`src/state.ts`). The consent reference is that ID. It also supports services within categories (`acceptService`, `acceptedService`, `services` in the category config).
- `ConsentConfig.hooks.onDecision(state, info)` already fires once per visitor decision and is documented as the place for consent records.
- `needsPrompt` and per-service `catalogRevision` already re-ask the visitor when a service is added or changed. Keep this behavior.
- Client boots from public JSON (`toPublicJson` / `fromPublicJson`). Keep it.
- Strict translation policy: new texts must exist in en and in every shipped pack (sk, fr, de), or the build fails.
- Astro components in `src/astro` are shipped in the npm package (`files`: `dist`, `src/astro`).

## Behavior the builder must deliver

**State.** `ConsentState` gains the accepted service ids. A category counts as accepted when at least one of its services is accepted. `isAllowed(id)` is true only if that service itself is accepted and its revisions are current. `DecisionInfo` also reports which services changed. A cookie in the previous category-only format is read as "all services of the accepted categories" (my call; nothing is live). The stored cookie must stay within `MAX_COOKIE_LENGTH` with the full shipped catalog selected; add a test.

**Client API.** Add the means to set an exact set of services, accept or refuse a single service, and withdraw. **Withdraw (my call):** Withdraw consent stores a necessary-only decision under the same consent reference, so the earlier records still point at the same visitor, and does not re-show the banner or reload the page. It is the same effect as Reject all but is reported as its own decision kind (`'withdraw'`, added to `DecisionInfo.kind`) so consent records can tell a withdrawal from a first refusal. The panel shows the Withdraw button only while at least one optional service is allowed. `acceptCategory`, `acceptAll`, `rejectAll`, `allowOnce` keep working. The embed placeholder's "allow" button now allows that one service, not the whole category.

**Panel.** Real `input` switches with labels, keyboard operable, visible focus, saved-state announced to screen readers, works in RTL. Without JavaScript it renders as a read-only list like today. The category toggle is tri-state. Storage tables per service stay, with an "no storage documented" line when a service has none. It also reacts to the `ready` and `decision` events.

**Banner and dialog.** Bottom bar with equal-weight buttons, Settings opens the dialog with per-service toggles, using the engine's native service support. The dialog and the panel call the same client API so they cannot drift. The cookie written by the client API is the single source of truth for per-service state. Try the engine's native dialog first; if its per-service toggles cannot be made to go through that API or be read back from it, replacing the dialog with a custom one is allowed (my call: the author does not care which dialog it is, only that it behaves identically to the panel).

**Reference display.** Show the stored `consentId` as is (my call: no reformatting), with a Copy button, and the timestamp formatted for the visitor's locale.

**Theming.** One stylesheet, imported by the Astro components. It maps the engine's own color variables to the site tokens with fallbacks and a dark variant under `.dark`. Also reachable for non-Astro use by a package export (builder's call on the path).

**Catalog.** New unverified entries: Google Analytics 4 (analytics), Google Tag Manager, Meta Pixel (marketing), with translations in sk, fr, de. The author chose full support: GA4 and Meta Pixel need setup code after their script loads (a measurement or pixel ID, then an init call), so the library runs that setup itself from the entry's options (for example `googleAnalytics({ measurementId })`), written as library code and not inline scripts, so a strict Content Security Policy keeps working. `cspSources` must cover each provider's script, connect and image hosts. This needs schema, validation, gating and test work beyond a plain `src` script. Google Tag Manager defaults to the marketing category (it can load arbitrary tags; my call) with a category override like other entries, and its notes say that tags inside the container are not gated individually by this library. `lastVerified` is set only where provider documentation backs every fact; otherwise null with "UNVERIFIED" in the notes, per the existing rule. Gating is `script` where the provider supplies a script URL.

**Texts.** All new visitor-facing texts (reference label, copy, saved at, policy version, language, choice summary, save, withdraw, expand/hide details, "n of m allowed", mixed state, no storage documented, per-service allow button) go through the pack system in en, sk, fr, de.

**Admin.** The local admin's playground gains a preview of the banner and the panel with a switch for light / dark / no tokens.

## Left to the builder

Component and file names, DOM structure and class names, message key names, the engine integration details, how progressive enhancement is done, the package export path for the stylesheet, test layout. Keep the existing test style (vitest, jsdom, Astro and admin smoke suites) and add tests for state parsing, per-service gating, tri-state, legacy cookie, cookie size, panel behavior and token fallbacks.

## Notes

Not legal advice. The consent reference is a persistent identifier held in a first-party cookie so that consent can be demonstrated; the privacy page should say so, which is part of the host site's own text.
