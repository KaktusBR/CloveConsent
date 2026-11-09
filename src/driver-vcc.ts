import * as CC from 'vanilla-cookieconsent'
import type { Category } from './schema'
import type { ConsentDriver, DriverHooks, StoredData } from './driver'
import { escapeHtml as esc } from './html'
import { readCookieValue } from './state'
import type { View } from './view'

export function buildVccConfig(view: View, hooks: DriverHooks, secure: boolean): Record<string, unknown> {
  const m = view.m
  const categories: Record<string, unknown> = {}
  for (const c of view.categories) {
    if (c.id === 'necessary') { categories.necessary = { enabled: true, readOnly: true }; continue }
    const cookies = c.services.flatMap((s) => s.storage.filter((x) => x.type === 'cookie').map((x) => ({ name: x.name })))
    // the engine only records per-service acceptance for services declared here; undeclared ones are stored as an empty list.
    // Without service toggles the dialog shows group toggles only and the client keeps working per category.
    const services = view.ui.manager.serviceToggles
      ? Object.fromEntries(c.services.map((s) => {
        const names = s.storage.filter((x) => x.type === 'cookie').map((x) => ({ name: x.name }))
        return [s.id, { label: esc(s.title), ...(names.length ? { cookies: names } : {}) }]
      }))
      : null
    categories[c.id] = { enabled: false, readOnly: false, ...(services ? { services } : {}), ...(cookies.length ? { autoClear: { cookies } } : {}) }
  }
  const sections: unknown[] = [{ title: esc(m.prefsTitle), description: esc(m.prefsIntro) }]
  for (const c of view.categories) {
    const rows = c.services.flatMap((s) => s.storage)
    sections.push({
      title: esc(c.readOnly ? `${c.title} (${m.alwaysActive})` : c.title),
      description: esc([c.description, ...c.services.map((s) => `${s.title}: ${s.description}`)].join(' ')),
      linkedCategory: c.id,
      ...(rows.length ? {
        cookieTable: {
          headers: { name: esc(m.tableName), type: esc(m.tableType), expiry: esc(m.tableExpiry), desc: esc(m.tablePurpose) },
          body: rows.map((r) => ({ name: esc(r.name), type: esc(r.type), expiry: esc(r.expiry), desc: esc(r.purpose) })),
        },
      } : {}),
    })
  }
  const footer = view.privacyHref ? `<a href="${esc(view.privacyHref)}" class="cc__link">${esc(m.privacyLink)}</a>` : ''
  return {
    revision: 0,
    cookie: { name: view.cookieName, path: '/', sameSite: 'Lax', expiresAfterDays: 182, secure },
    guiOptions: {
      consentModal: { ...view.ui.banner },
      preferencesModal: { ...view.ui.dialog, equalWeightButtons: true, flipButtons: false },
    },
    categories,
    language: {
      default: view.locale,
      ...(view.dir === 'rtl' ? { rtl: view.locale } : {}),
      translations: {
        [view.locale]: {
          consentModal: {
            title: esc(m.bannerTitle), description: esc(m.bannerText),
            acceptAllBtn: esc(m.acceptAll), acceptNecessaryBtn: esc(m.rejectAll), showPreferencesBtn: esc(m.manage), footer,
          },
          preferencesModal: {
            title: esc(m.prefsTitle), acceptAllBtn: esc(m.acceptAll), acceptNecessaryBtn: esc(m.rejectAll),
            savePreferencesBtn: esc(m.savePrefs), closeIconLabel: esc(m.close), sections,
          },
        },
      },
    },
    onFirstConsent: () => hooks.onFirstConsent(),
    onConsent: () => hooks.onConsent(),
    // the engine reports changed services as an object keyed by category; the hook takes a flat list of ids
    // without service toggles no service is declared to the engine, so a changed category stands for all its services
    onChange: ({ changedCategories, changedServices }: { changedCategories: string[]; changedServices?: Record<string, string[]> }) =>
      hooks.onChange(changedCategories as Category[], view.ui.manager.serviceToggles
        ? [...new Set(Object.values(changedServices ?? {}).flat())]
        : view.categories.filter((c) => changedCategories.includes(c.id)).flatMap((c) => c.services.map((s) => s.id))),
    // Only hiding the consent modal (the banner) is a decision: the library hides it solely from its
    // accept/reject/save buttons (and our own hide() after acceptCategory). Closing the preferences modal
    // (X, Escape, overlay) hides only 'preferencesModal' and must not count. The banner buttons call
    // hide() *before* acceptCategory(), so defer until the library has applied the choice.
    onModalHide: ({ modalName }: { modalName: string }) => {
      if (modalName === 'consentModal') queueMicrotask(() => hooks.onDecision())
    },
  }
}

// the engine reports one callback per accepted category or service call; acceptServices makes several calls for one decision
interface Batch { first: boolean; consent: boolean; categories: Set<Category>; services: Set<string> }

export function createVccDriver(): ConsentDriver {
  let cookieName = 'cc_cookie'
  let target: DriverHooks | null = null
  let perService = true
  let batch: Batch | null = null
  // a programmatic decision closes the UI like the library's own buttons do
  const decide = (c: string | string[]) => { CC.acceptCategory(c); CC.hidePreferences(); CC.hide() }
  // while a batch is open the engine's callbacks are collected and replayed once, so the client sees one decision
  const batched: DriverHooks = {
    onFirstConsent: () => { if (batch) batch.first = true; else target?.onFirstConsent() },
    onConsent: () => { if (batch) batch.consent = true; else target?.onConsent() },
    onChange: (changed, services) => {
      if (!batch) { target?.onChange(changed, services); return }
      changed.forEach((c) => batch!.categories.add(c)); services.forEach((s) => batch!.services.add(s))
    },
    onDecision: () => target?.onDecision(),
  }
  return {
    init(view, hooks) {
      target = hooks
      cookieName = view.cookieName
      perService = view.ui.manager.serviceToggles
      if (view.darkMode) {
        const html = document.documentElement
        const sync = () => html.classList.toggle('cc--darkmode', html.classList.contains('dark'))
        sync()
        new MutationObserver(sync).observe(html, { attributeFilter: ['class'] })
      }
      Promise.resolve(CC.run(buildVccConfig(view, batched, location.protocol === 'https:') as never)).catch((e) => console.error('[consent] vanilla-cookieconsent failed to start', e))
    },
    readRaw() { try { return readCookieValue(document.cookie, cookieName) } catch { return null } },
    writeData(data: StoredData) { CC.setCookieData({ value: data, mode: 'overwrite' } as never) },
    showBanner() { CC.show(true) },
    open() { CC.showPreferences() },
    acceptAll() { decide('all') },
    rejectAll() { decide([]) },
    acceptCategories(categories) { decide(categories as string[]) },
    acceptServices(selection) {
      // the engine knows no services without toggles: a category with any listed service is accepted as a whole
      if (!perService) { decide(Object.entries(selection).filter(([, ids]) => ids.length > 0).map(([c]) => c)); return }
      // accepting services of a category also accepts the category; an empty list removes it. Categories left out are not accepted.
      const have = (CC.getUserPreferences().acceptedCategories as string[]).filter((c) => c !== 'necessary')
      const wanted: Record<string, string[]> = { ...Object.fromEntries(have.map((c) => [c, []])), ...selection }
      delete wanted.necessary
      const some = Object.entries(wanted).filter(([, ids]) => ids.length > 0)
      const none = Object.entries(wanted).filter(([, ids]) => ids.length === 0)
      const b: Batch = { first: false, consent: false, categories: new Set(), services: new Set() }
      batch = b
      let failure: unknown = null; let failed = false
      try {
        // with nothing selected there may be no consent yet; rejecting everything records it
        if (some.length === 0) CC.acceptCategory([])
        // accepted categories first, so the visitor's first answer is created by a real selection
        for (const [category, ids] of [...some, ...none]) CC.acceptService(ids, category)
        CC.hidePreferences(); CC.hide()
      } catch (err) { failed = true; failure = err } finally { batch = null }
      // replay what the engine already applied even when a later call failed: the cookie has changed, so the decision must be
      // persisted, unloaded and reported
      if (b.first) { target?.onFirstConsent(); if (b.consent) target?.onConsent() }
      else if (b.categories.size > 0 || b.services.size > 0) target?.onChange([...b.categories], [...b.services])
      if (failed) throw failure
    },
  }
}
