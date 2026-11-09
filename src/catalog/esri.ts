import type { Category, ClientEntry } from '../schema'
import { CATALOG } from './helpers'

/**
 * Esri World Imagery satellite tiles (server.arcgisonline.com), for example as a layer of a Leaflet map. The tiles are fetched by
 * the site's own map code, so nothing is gated automatically: create the tile layer only when `consent.isAllowed('esri-imagery')`.
 */
export function esriImagery(o: { category?: Category } = {}): ClientEntry {
  return {
    ...CATALOG, kind: 'client', id: 'esri-imagery', catalogRevision: 1, lastVerified: null,
    category: o.category ?? 'media',
    provider: { name: 'Esri', privacyUrl: 'https://www.esri.com/en-us/privacy/privacy-statements/privacy-statement' },
    storage: [],
    gating: { type: 'none' },
    origins: ['server.arcgisonline.com'],
    csp: { 'img-src': ['server.arcgisonline.com'] },
    messages: {
      title: { en: 'Esri satellite imagery' },
      description: { en: 'Satellite map images loaded from Esri servers. Esri receives your IP address when the map loads.' },
    },
    notes: 'UNVERIFIED: Esri documents neither what the World Imagery tile service logs nor whether it sets browser storage, so storage is empty here because it is unknown, not because it is none. Esri\'s terms for the imagery (attribution text, usage limits) were not checked here. See docs/concepts/the-catalog.md.',
  }
}
