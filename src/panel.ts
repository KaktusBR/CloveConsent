import { getConsent, type Consent } from './client'
import { format } from './messages'
import { groupState, renderSettings } from './settings'
import { resolveUi, THEME_TOKENS, type ThemeToken } from './ui-settings'
import { buildView, type View } from './view'

interface Binding { consent: Consent; unbind: () => void }
const bindings = new WeakMap<HTMLElement, Binding>()

const CONTROL_ATTRS = ['data-consent-group', 'data-consent-service', 'data-consent-action']

/** The id-carrying attribute of a control, so the same control can be found again after the panel is rendered anew. */
function controlKey(el: Element | null): [string, string] | null {
  if (!el) return null
  for (const attr of CONTROL_ATTRS) {
    const v = el.getAttribute(attr)
    if (v !== null) return [attr, v]
  }
  return null
}
function findControl(root: HTMLElement, key: [string, string]): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>(`[${key[0]}]`)].find((el) => el.getAttribute(key[0]) === key[1]) ?? null
}

function syncSummary(details: Element): void {
  const summary = details.querySelector('summary')
  if (!summary) return
  const text = details.hasAttribute('open') ? summary.getAttribute('data-hide') : summary.getAttribute('data-show')
  if (text) summary.textContent = text
}
/**
 * A switch has no mixed state in ARIA (`aria-checked="mixed"` is not valid on `role="switch"`), so a partly accepted group keeps
 * `role="switch"`, is set `indeterminate` (shown by browsers that render it) and is described by the visible "Some allowed" text
 * (`aria-describedby`, rendered by `renderSettings`). The look follows `data-state`.
 */
function syncMixed(group: HTMLInputElement): void {
  group.indeterminate = group.getAttribute('data-state') === 'mixed'
}

/**
 * Makes a rendered settings panel interactive: switches, the action buttons and the reference copy, and keeps it in step with the
 * consent state. Idempotent per root (a second call returns the first unbind). Returns the function that removes every listener and
 * subscription again.
 */
export function bindSettings(consent: Consent, root: HTMLElement): () => void {
  const existing = bindings.get(root)
  if (existing) {
    if (existing.consent === consent) return existing.unbind
    existing.unbind()
  }
  const doc = root.ownerDocument
  const view: View = buildView(consent.config, consent.locale)
  const m = view.m
  const perService = view.ui.manager.serviceToggles
  const optional = view.categories.filter((c) => !c.readOnly)
  let lastHtml: string | null = null
  let wasConnected = root.isConnected
  let disposed = false

  let pending: ReturnType<typeof setTimeout> | null = null
  const cancelAnnounce = (): void => { if (pending !== null) { clearTimeout(pending); pending = null } }
  /** Writes into the live region: cleared first and set on a later task, so the same text twice in a row is announced twice. */
  const announce = (text: string): void => {
    cancelAnnounce()
    const el = root.querySelector('.consent-status')
    if (!el) return
    el.textContent = ''
    if (!text) return
    pending = setTimeout(() => {
      pending = null
      const now = root.querySelector('.consent-status')
      if (now && !disposed) now.textContent = text
    }, 0)
  }
  // what the visitor has chosen and stored: a one-time allowance (allowOnce) is not a choice and must never be saved by the panel
  const allowedIds = (): Set<string> => {
    const optionalIds = new Set(optional.flatMap((c) => c.services.map((s) => s.id)))
    return new Set(consent.acceptedServices().filter((id) => optionalIds.has(id)))
  }
  let renders = 0

  /** Renders the panel for the current state into the root. Event-driven renders skip an unchanged state so unsaved ticks survive. */
  function render(force: boolean): void {
    const html = renderSettings(view, consent.getState(), allowedIds())
    if (!force && html === lastHtml) return
    lastHtml = html
    renders++
    const focused = root.contains(doc.activeElement) ? controlKey(doc.activeElement) : null
    const open = new Set([...root.querySelectorAll('[data-category]')].filter((c) => c.querySelector('details[open]')).map((c) => c.getAttribute('data-category')))
    const tpl = doc.createElement('template')
    tpl.innerHTML = html
    const fresh = tpl.content.firstElementChild
    if (!fresh) return
    // keep the live region node itself: a replaced node is not reliably announced
    const live = root.querySelector('.consent-status')
    const placeholder = fresh.querySelector('.consent-status')
    if (live && placeholder) placeholder.replaceWith(live)
    root.replaceChildren(...fresh.childNodes)
    root.querySelectorAll('[data-category]').forEach((cat) => {
      const details = cat.querySelector('details')
      if (details && open.has(cat.getAttribute('data-category'))) details.setAttribute('open', '')
      if (details) syncSummary(details)
    })
    root.querySelectorAll<HTMLInputElement>('input[data-consent-group]').forEach(syncMixed)
    if (focused) {
      const again = findControl(root, focused) ?? findControl(root, ['data-consent-action', 'save'])
      if (again && doc.activeElement !== again) again.focus()
    }
  }

  /** Brings a category's group switch, state label and count in line with the switches the visitor has set. */
  function refreshCategory(cat: Element): void {
    const c = optional.find((x) => x.id === cat.getAttribute('data-category'))
    const group = cat.querySelector<HTMLInputElement>('input[data-consent-group]')
    if (!c || !group) return
    const ids = c.services.map((s) => s.id)
    const selected = new Set(perService
      ? ids.filter((id) => [...cat.querySelectorAll<HTMLInputElement>('input[data-consent-service]')].some((i) => i.getAttribute('data-consent-service') === id && i.checked))
      : group.checked ? ids : [])
    const state = groupState(selected, ids)
    group.checked = state === 'on'
    group.setAttribute('data-state', state)
    syncMixed(group)
    const label = cat.querySelector('.consent-category__state')
    if (label) label.textContent = state === 'mixed' ? (label.getAttribute('data-mixed-label') ?? m.stateMixed) : ''
    const count = cat.querySelector('.consent-category__count')
    if (count) count.textContent = format(m.servicesAllowed, { allowed: String(selected.size), total: String(ids.length) })
  }

  /** Exactly the services the visitor has ticked (every service of a ticked category when there are no per-service switches). */
  function chosen(): string[] {
    const out: string[] = []
    for (const c of optional) {
      const cat = [...root.querySelectorAll('[data-category]')].find((x) => x.getAttribute('data-category') === c.id)
      if (!cat) continue
      if (perService) {
        cat.querySelectorAll<HTMLInputElement>('input[data-consent-service]').forEach((i) => {
          if (i.checked && !i.disabled) out.push(i.getAttribute('data-consent-service')!)
        })
      } else if (cat.querySelector<HTMLInputElement>('input[data-consent-group]')?.checked) {
        out.push(...c.services.map((s) => s.id))
      }
    }
    return out
  }

  function selectReference(): void {
    const code = root.querySelector('.consent-receipt__id')
    const sel = doc.getSelection?.()
    if (!code || !sel) return
    try {
      const range = doc.createRange()
      range.selectNodeContents(code)
      sel.removeAllRanges()
      sel.addRange(range)
    } catch { /* selecting is only a convenience */ }
  }
  async function copy(): Promise<void> {
    const ref = root.querySelector('.consent-receipt__id')?.textContent?.trim()
    if (!ref) return
    const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (!clip || typeof clip.writeText !== 'function') { selectReference(); return }
    try {
      await clip.writeText(ref)
      if (!disposed) announce(m.receiptCopied)
    } catch {
      // permission denied or no secure context: leave the reference selected so the visitor can copy it by hand
      if (!disposed) selectReference()
    }
  }

  const onClick = (ev: Event): void => {
    if (!(ev.target instanceof Element)) return
    const btn = ev.target.closest<HTMLElement>('[data-consent-action]')
    if (!btn || !root.contains(btn)) return
    const name = btn.getAttribute('data-consent-action')
    const before = renders
    if (name === 'copy') { void copy(); return }
    if (name === 'accept-all') consent.acceptAll()
    else if (name === 'reject-all') consent.rejectAll()
    else if (name === 'withdraw') consent.withdraw()
    else if (name === 'save') consent.setServices(chosen())
    else return
    // a decision has already re-rendered the panel; only an action that changed nothing still needs to reset the switches
    if (renders === before) render(true)
    announce(m.settingsSaved)
  }
  const onChange = (ev: Event): void => {
    const t = ev.target
    if (!(t instanceof HTMLInputElement) || !root.contains(t)) return
    const cat = t.closest('[data-category]')
    if (!cat) return
    if (t.hasAttribute('data-consent-group')) {
      if (perService) cat.querySelectorAll<HTMLInputElement>('input[data-consent-service]').forEach((i) => { if (!i.disabled) i.checked = t.checked })
    } else if (!t.hasAttribute('data-consent-service')) return
    refreshCategory(cat)
    announce('')
  }
  // the summary text follows the open state; `toggle` does not bubble, so it is caught in the capture phase
  const onToggle = (ev: Event): void => {
    if (ev.target instanceof Element && ev.target.matches('details') && root.contains(ev.target)) syncSummary(ev.target)
  }

  const onConsentEvent = (): void => {
    if (root.isConnected) wasConnected = true
    else if (wasConnected) { unbind(); return } // the page was swapped (view transitions): this panel is gone
    render(false)
  }

  root.addEventListener('click', onClick)
  root.addEventListener('change', onChange)
  root.addEventListener('toggle', onToggle, true)
  const offs = [consent.on('ready', onConsentEvent), consent.on('decision', onConsentEvent), consent.on('once', onConsentEvent)]
  function unbind(): void {
    if (disposed) return
    disposed = true
    cancelAnnounce()
    root.removeEventListener('click', onClick)
    root.removeEventListener('change', onChange)
    root.removeEventListener('toggle', onToggle, true)
    for (const off of offs) off()
    if (bindings.get(root)?.unbind === unbind) bindings.delete(root)
  }
  bindings.set(root, { consent, unbind })
  render(true)
  return unbind
}

const watched = new WeakSet<Document>()
function bindAll(doc: Document): void {
  const consent = getConsent()
  if (!consent) return
  doc.querySelectorAll<HTMLElement>('[data-consent-settings]').forEach((root) => { bindSettings(consent, root) })
}

/**
 * Binds every `[data-consent-settings]` panel in the document to the client. The client may not exist yet when this runs, so it
 * tries again when the document finishes loading and on every `astro:page-load` (a view transition brings new panels). Safe to
 * call repeatedly: a panel is bound once and the page listeners are registered once per document.
 */
export function bindSettingsFromDom(doc: Document = document): void {
  if (!watched.has(doc)) {
    watched.add(doc)
    const again = () => bindAll(doc)
    doc.addEventListener('astro:page-load', again)
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', again, { once: true })
    doc.defaultView?.addEventListener('load', again, { once: true })
  }
  bindAll(doc)
}

const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/**
 * Sets the theme tokens as `--consent-override-<name>` custom properties on the element, with `style.setProperty` only: no CSS text,
 * no attributes. The values were validated when the configuration was built; each one is checked again here, and a value that fails
 * (or an unknown token name) is skipped.
 */
export function applyTheme(el: HTMLElement, tokens: Partial<Record<ThemeToken, string>>): void {
  for (const name of THEME_TOKENS) {
    const value = tokens[name]
    if (typeof value !== 'string') continue
    try { resolveUi({ theme: { tokens: { [name]: value } } }) } catch { continue }
    el.style.setProperty(`--consent-override-${kebab(name)}`, value)
  }
}
