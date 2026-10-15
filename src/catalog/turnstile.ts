import type { Category, ClientEntry } from '../schema'
import { CATALOG } from './helpers'

export function turnstile(o: { category?: Category } = {}): ClientEntry {
  return {
    ...CATALOG, kind: 'client', id: 'cloudflare-turnstile', catalogRevision: 1, lastVerified: null,
    category: o.category ?? 'necessary',
    provider: { name: 'Cloudflare', privacyUrl: 'https://www.cloudflare.com/privacypolicy/' },
    storage: [],
    gating: { type: 'none' },
    origins: ['challenges.cloudflare.com'],
    csp: { 'script-src': ['challenges.cloudflare.com'], 'frame-src': ['challenges.cloudflare.com'] },
    messages: {
      title: { en: 'Cloudflare Turnstile' },
      description: { en: 'Protects forms from bots.' },
    },
    notes: 'On localhost add localhost to the widget hostnames or use Cloudflare test keys. UNVERIFIED: Cloudflare docs confirm the CSP hosts but do not list browser storage the Turnstile widget sets (cf_clearance is documented only for pre-clearance mode), so storage is empty here because it is unknown, not because it is none. See docs/concepts/the-catalog.md.',
  }
}
