import { CATEGORIES, type Category, type ConsentConfig, type Locale } from './schema'
import { messages, type Messages } from './messages'

export interface ViewService { id: string; title: string; description: string; provider: string | null; storage: { name: string; type: string; expiry: string; purpose: string }[] }
export interface ViewCategory { id: Category; title: string; description: string; readOnly: boolean; services: ViewService[] }
export interface ViewProcessor { id: string; provider: string; privacyUrl: string; purpose: string; dataCategories: string[]; location: string; dpaUrl: string | null; transfers: string | null }
export interface View { locale: Locale; m: Messages; cookieName: string; darkMode: boolean; privacyHref: string | null; categories: ViewCategory[]; processors: ViewProcessor[] }

const CAT_TEXT: Record<Category, [keyof Messages, keyof Messages]> = {
  necessary: ['catNecessary', 'catNecessaryText'], functional: ['catFunctional', 'catFunctionalText'],
  media: ['catMedia', 'catMediaText'], social: ['catSocial', 'catSocialText'],
  analytics: ['catAnalytics', 'catAnalyticsText'], marketing: ['catMarketing', 'catMarketingText'],
}

export function buildView(config: ConsentConfig, requested: Locale): View {
  const locale: Locale = config.locales.includes(requested) ? requested : config.defaultLocale
  const m = messages[locale]
  const categories: ViewCategory[] = []
  for (const id of CATEGORIES) {
    const entries = config.services.filter((s) => s.category === id)
    if (entries.length === 0 && id !== 'necessary') continue
    const [t, d] = CAT_TEXT[id]
    categories.push({
      id, title: m[t], description: m[d], readOnly: id === 'necessary',
      services: entries.map((s) => ({
        id: s.id, title: s.messages.title[locale], description: s.messages.description[locale],
        provider: s.kind === 'client' ? s.provider.name : null,
        storage: s.storage.map((x) => ({ name: x.name, type: x.type, expiry: x.expiry[locale], purpose: x.purpose[locale] })),
      })),
    })
  }
  return {
    locale, m, cookieName: config.cookieName, darkMode: config.darkMode, privacyHref: config.privacyHref, categories,
    processors: config.processors.map((p) => ({
      id: p.id, provider: p.provider.name, privacyUrl: p.provider.privacyUrl, purpose: p.purpose[locale],
      dataCategories: p.dataCategories.map((d) => d[locale]), location: p.location[locale],
      dpaUrl: p.dpaUrl ?? null, transfers: p.transfers ? p.transfers[locale] : null,
    })),
  }
}
