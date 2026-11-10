import { CATEGORIES, type Category, type ConsentConfig, type Locale, type Localised } from './schema'
import type { Messages } from './messages'
import type { UiSettings } from './ui-settings'
import { isRtl } from './i18n/rtl'

export interface ViewService { id: string; title: string; description: string; provider: string | null; iframe: boolean; storage: { name: string; type: string; expiry: string; purpose: string }[] }
export interface ViewCategory { id: Category; title: string; description: string; readOnly: boolean; services: ViewService[] }
export interface ViewProcessor { id: string; provider: string; privacyUrl: string; purpose: string; dataCategories: string[]; location: string; dpaUrl: string | null; transfers: string | null }
export interface View { locale: Locale; dir: 'ltr' | 'rtl'; m: Messages; cookieName: string; cookieDomain: string | null; darkMode: boolean; privacyHref: string | null; categories: ViewCategory[]; processors: ViewProcessor[]; ui: UiSettings }

const CAT_TEXT: Record<Category, [keyof Messages, keyof Messages]> = {
  necessary: ['catNecessary', 'catNecessaryText'], functional: ['catFunctional', 'catFunctionalText'],
  media: ['catMedia', 'catMediaText'], social: ['catSocial', 'catSocialText'],
  analytics: ['catAnalytics', 'catAnalyticsText'], marketing: ['catMarketing', 'catMarketingText'],
}

export function buildView(config: ConsentConfig, requested: Locale): View {
  const locale: Locale = config.locales.includes(requested) ? requested : config.defaultLocale
  const m = config.messages[locale] as Messages
  // defineConsent fills every text for every enabled locale; `en` only satisfies the type
  const text = (v: Localised): string => v[locale] ?? v.en
  const categories: ViewCategory[] = []
  for (const id of CATEGORIES) {
    const entries = config.services.filter((s) => s.category === id)
    if (entries.length === 0 && id !== 'necessary') continue
    const [t, d] = CAT_TEXT[id]
    categories.push({
      id, title: m[t], description: m[d], readOnly: id === 'necessary',
      services: entries.map((s) => ({
        id: s.id, title: text(s.messages.title), description: text(s.messages.description),
        provider: s.kind === 'client' ? s.provider.name : null,
        iframe: s.kind === 'client' && s.gating.type === 'iframe',
        storage: s.storage.map((x) => ({ name: x.name, type: x.type, expiry: text(x.expiry), purpose: text(x.purpose) })),
      })),
    })
  }
  return {
    locale, dir: isRtl(locale) ? 'rtl' : 'ltr', m, cookieName: config.cookieName, cookieDomain: config.cookieDomain, darkMode: config.darkMode, privacyHref: config.privacyHref, categories,
    ui: config.ui,
    processors: config.processors.map((p) => ({
      id: p.id, provider: p.provider.name, privacyUrl: p.provider.privacyUrl, purpose: text(p.purpose),
      dataCategories: p.dataCategories.map((d) => text(d)), location: text(p.location),
      dpaUrl: p.dpaUrl ?? null, transfers: p.transfers ? text(p.transfers) : null,
    })),
  }
}
