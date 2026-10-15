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
    categories[c.id] = { enabled: false, readOnly: false, ...(cookies.length ? { autoClear: { cookies } } : {}) }
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
      consentModal: { layout: 'box', position: 'bottom left', equalWeightButtons: true, flipButtons: false },
      preferencesModal: { layout: 'box', position: 'right', equalWeightButtons: true, flipButtons: false },
    },
    categories,
    language: {
      default: view.locale,
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
    onChange: ({ changedCategories }: { changedCategories: string[] }) => hooks.onChange(changedCategories as Category[]),
    // Only hiding the consent modal (the banner) is a decision: the library hides it solely from its
    // accept/reject/save buttons (and our own hide() after acceptCategory). Closing the preferences modal
    // (X, Escape, overlay) hides only 'preferencesModal' and must not count. The banner buttons call
    // hide() *before* acceptCategory(), so defer until the library has applied the choice.
    onModalHide: ({ modalName }: { modalName: string }) => {
      if (modalName === 'consentModal') queueMicrotask(() => hooks.onDecision())
    },
  }
}

export function createVccDriver(): ConsentDriver {
  let cookieName = 'cc_cookie'
  // a programmatic decision closes the UI like the library's own buttons do
  const decide = (c: string | string[]) => { CC.acceptCategory(c); CC.hidePreferences(); CC.hide() }
  return {
    init(view, hooks) {
      cookieName = view.cookieName
      if (view.darkMode) {
        const html = document.documentElement
        const sync = () => html.classList.toggle('cc--darkmode', html.classList.contains('dark'))
        sync()
        new MutationObserver(sync).observe(html, { attributeFilter: ['class'] })
      }
      Promise.resolve(CC.run(buildVccConfig(view, hooks, location.protocol === 'https:') as never)).catch((e) => console.error('[consent] vanilla-cookieconsent failed to start', e))
    },
    readRaw() { try { return readCookieValue(document.cookie, cookieName) } catch { return null } },
    writeData(data: StoredData) { CC.setCookieData({ value: data, mode: 'overwrite' } as never) },
    showBanner() { CC.show(true) },
    open() { CC.showPreferences() },
    acceptAll() { decide('all') },
    rejectAll() { decide([]) },
    acceptCategories(categories) { decide(categories as string[]) },
  }
}
