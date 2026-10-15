import type { Category, FirstPartyEntry } from '../schema'
import { CATALOG } from './helpers'

/** A site's own light/dark choice. The storage key is whatever your site uses; the default `theme` is only a convention. */
export function theme(o: { category?: Category; key?: string } = {}): FirstPartyEntry {
  return {
    ...CATALOG, kind: 'first-party', id: 'theme', catalogRevision: 1, lastVerified: null,
    category: o.category ?? 'functional',
    storage: [{
      name: o.key ?? 'theme', type: 'localStorage',
      expiry: { en: 'Persistent (until you delete it)' },
      purpose: { en: 'Remembers light or dark appearance.' },
    }],
    messages: {
      title: { en: 'Site theme' },
      description: { en: 'Saves your light or dark theme choice.' },
    },
  }
}
