import { escapeHtml as e } from './html'
import { format } from './messages'
import type { ConsentState } from './schema'
import type { View, ViewCategory, ViewService } from './view'

export type SwitchState = 'on' | 'off' | 'mixed'

/** State of a group switch: every service selected is `on`, none (or no services) is `off`, anything between is `mixed`. */
export function groupState(selected: ReadonlySet<string>, serviceIds: readonly string[]): SwitchState {
  if (serviceIds.length === 0) return 'off'
  const n = serviceIds.filter((id) => selected.has(id)).length
  if (n === 0) return 'off'
  return n === serviceIds.length ? 'on' : 'mixed'
}

/** Summary of a saved choice over the optional (non-necessary) service ids. */
export function choiceSummary(allowed: ReadonlySet<string>, optionalIds: readonly string[]): 'all' | 'necessary' | 'custom' {
  const state = groupState(allowed, optionalIds)
  return state === 'on' ? 'all' : state === 'off' ? 'necessary' : 'custom'
}

/** Locale-aware date and time of a stored timestamp; an em dash when it is missing or not a date. */
export function formatSaved(timestamp: string | null, locale: string): string {
  if (!timestamp) return '—'
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return '—'
  const options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }
  try {
    return new Intl.DateTimeFormat(locale, options).format(d)
  } catch {
    return new Intl.DateTimeFormat('en', options).format(d)
  }
}

function receipt(view: View, state: ConsentState | null, allowed: ReadonlySet<string>): string {
  const m = view.m
  const head = `<h3 class="consent-receipt__title">${e(m.receiptTitle)}</h3>`
  if (!state) return `<div class="consent-receipt">${head}<p class="consent-receipt__meta">${e(m.receiptNone)}</p></div>`
  const optional = view.categories.filter((c) => !c.readOnly).flatMap((c) => c.services.map((s) => s.id))
  const choice = choiceSummary(allowed, optional)
  const choiceText = choice === 'all' ? m.choiceAll : choice === 'necessary' ? m.choiceNecessary : m.choiceCustom
  const policy = state.siteRevision === null ? '—' : String(state.siteRevision)
  return `<div class="consent-receipt">${head}`
    + `<div class="consent-receipt__ref"><code class="consent-receipt__id">${e(state.consentId)}</code>`
    + `<button type="button" class="consent-btn consent-btn--secondary" data-consent-action="copy" data-copied="${e(m.receiptCopied)}">${e(m.receiptCopy)}</button></div>`
    + `<dl class="consent-receipt__meta">`
    + `<div><dt>${e(m.receiptSaved)}</dt><dd>${e(formatSaved(state.timestamp, view.locale))}</dd></div>`
    + `<div><dt>${e(m.receiptPolicy)}</dt><dd>${e(policy)}</dd></div>`
    + `<div><dt>${e(m.receiptLanguage)}</dt><dd>${e(view.locale)}</dd></div>`
    + `<div><dt>${e(m.receiptChoice)}</dt><dd>${e(choiceText)}</dd></div>`
    + `</dl></div>`
}

function storage(view: View, s: ViewService): string {
  const m = view.m
  if (s.storage.length === 0) return `<p class="consent-service__none">${e(m.noStorage)}</p>`
  const rows = s.storage
    .map((r) => `<tr><td>${e(r.name)}</td><td>${e(r.type)}</td><td>${e(r.expiry)}</td><td>${e(r.purpose)}</td></tr>`)
    .join('')
  return `<table class="consent-table"><thead><tr><th scope="col">${e(m.tableName)}</th><th scope="col">${e(m.tableType)}</th>`
    + `<th scope="col">${e(m.tableExpiry)}</th><th scope="col">${e(m.tablePurpose)}</th></tr></thead><tbody>${rows}</tbody></table>`
}

function service(view: View, c: ViewCategory, s: ViewService, allowed: ReadonlySet<string>): string {
  const { serviceToggles, storageTables } = view.ui.manager
  const title = s.provider ? `${s.title} (${s.provider})` : s.title
  const id = `consent-service-${s.id}`
  const on = c.readOnly || allowed.has(s.id)
  const toggle = serviceToggles
    ? `<input type="checkbox" role="switch" class="consent-switch" id="${e(id)}" data-consent-service="${e(s.id)}"${on ? ' checked' : ''}${c.readOnly ? ' disabled' : ''}>`
      + `<label for="${e(id)}" class="consent-service__title">${e(title)}</label>`
    : `<span class="consent-service__title">${e(title)}</span>`
  return `<div class="consent-service" data-service="${e(s.id)}"><div class="consent-service__head">${toggle}</div>`
    + `<p class="consent-service__text">${e(s.description)}</p>${storageTables ? storage(view, s) : ''}</div>`
}

function category(view: View, c: ViewCategory, allowed: ReadonlySet<string>): string {
  const m = view.m
  const ids = c.services.map((s) => s.id)
  const state: SwitchState = c.readOnly ? 'on' : groupState(allowed, ids)
  const id = `consent-group-${c.id}`
  const count = !c.readOnly && ids.length > 0
    ? `<span class="consent-category__count">${e(format(m.servicesAllowed, { allowed: String(ids.filter((x) => allowed.has(x)).length), total: String(ids.length) }))}</span>`
    : ''
  const status = c.readOnly
    ? `<span class="consent-category__state">${e(m.alwaysActive)}</span>`
    : `<span class="consent-category__state" data-mixed-label="${e(m.stateMixed)}">${state === 'mixed' ? e(m.stateMixed) : ''}</span>`
  const open = view.ui.manager.details === 'open'
  const details = c.services.length === 0
    ? ''
    : `<details class="consent-category__details"${open ? ' open' : ''}>`
      + `<summary data-show="${e(m.showDetails)}" data-hide="${e(m.hideDetails)}">${e(open ? m.hideDetails : m.showDetails)}</summary>`
      + c.services.map((s) => service(view, c, s, allowed)).join('') + `</details>`
  return `<div class="consent-category" data-category="${e(c.id)}"><div class="consent-category__head">`
    + `<input type="checkbox" role="switch" class="consent-switch" id="${e(id)}" data-consent-group="${e(c.id)}" data-state="${state}"`
    + `${state === 'on' ? ' checked' : ''}${c.readOnly ? ' disabled' : ''}>`
    + `<label for="${e(id)}" class="consent-category__title">${e(c.title)}</label>${status}${count}</div>`
    + `<p class="consent-category__text">${e(c.description)}</p>${details}</div>`
}

function processors(view: View): string {
  const m = view.m
  const items = view.processors.map((p) => `<li data-processor="${e(p.id)}">`
    + `<strong><a href="${e(p.privacyUrl)}" rel="noopener noreferrer">${e(p.provider)}</a></strong>`
    + `<p>${e(p.purpose)}</p>`
    + `<p>${e(m.processorData)}: ${e(p.dataCategories.join(', '))}</p>`
    + `<p>${e(m.processorLocation)}: ${e(p.location)}</p>`
    + (p.transfers ? `<p>${e(m.processorTransfers)}: ${e(p.transfers)}</p>` : '')
    + (p.dpaUrl ? `<p><a href="${e(p.dpaUrl)}" rel="noopener noreferrer">${e(m.processorDpa)}</a></p>` : '')
    + `</li>`).join('')
  return `<section class="consent-processors"><h3>${e(m.processorsHeading)}</h3><ul>${items}</ul></section>`
}

/** The interactive settings panel as an HTML string. Pure: `allowed` and `state` come from the caller. */
export function renderSettings(view: View, state: ConsentState | null, allowed: ReadonlySet<string>): string {
  const m = view.m
  const ui = view.ui.manager
  const btn = (action: string, cls: string, text: string) =>
    `<button type="button" class="consent-btn consent-btn--${cls}" data-consent-action="${action}">${e(text)}</button>`
  const actions = btn('accept-all', 'primary', m.acceptAll) + btn('reject-all', 'primary', m.rejectAll) + btn('save', 'secondary', m.savePrefs)
    + (ui.withdraw && allowed.size > 0 ? btn('withdraw', 'secondary', m.withdraw) : '')
  return `<section class="consent-settings" data-consent-settings>`
    + `<h2 class="consent-settings__title">${e(m.settingsTitle)}</h2><p class="consent-settings__intro">${e(m.settingsIntro)}</p>`
    + (ui.receipt ? receipt(view, state, allowed) : '')
    + view.categories.map((c) => category(view, c, allowed)).join('')
    + (ui.processors ? processors(view) : '')
    + `<div class="consent-actions">${actions}</div>`
    + `<div class="consent-status" aria-live="polite"></div></section>`
}
