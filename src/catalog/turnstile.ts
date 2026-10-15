import type { Category, ClientEntry } from '../schema'
import { CATALOG, L } from './helpers'

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
      title: L('Cloudflare Turnstile', 'Cloudflare Turnstile', 'Cloudflare Turnstile', 'Cloudflare Turnstile'),
      description: L('Ochrana formulárov pred robotmi.', 'Protects forms from bots.', 'Protège les formulaires contre les robots.', 'Schützt Formulare vor Bots.'),
    },
    notes: 'On localhost add localhost to the widget hostnames or use Cloudflare test keys. UNVERIFIED: Cloudflare docs confirm the CSP hosts but do not list browser storage the Turnstile widget sets (cf_clearance is documented only for pre-clearance mode), so storage is empty here because it is unknown, not because it is none. See docs/catalog-verification.md.',
  }
}
