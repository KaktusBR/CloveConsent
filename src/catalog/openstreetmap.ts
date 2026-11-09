import type { Category, ClientEntry } from '../schema'
import { CATALOG } from './helpers'

/**
 * OpenStreetMap map tiles, for example behind a Leaflet map. The tiles are fetched by the site's own map code, so nothing is
 * gated automatically: create the tile layer only when `consent.isAllowed('openstreetmap')`.
 */
export function openStreetMap(o: { category?: Category } = {}): ClientEntry {
  return {
    ...CATALOG, kind: 'client', id: 'openstreetmap', catalogRevision: 1, lastVerified: null,
    category: o.category ?? 'media',
    provider: { name: 'OpenStreetMap Foundation', privacyUrl: 'https://osmfoundation.org/wiki/Privacy_Policy' },
    storage: [],
    gating: { type: 'none' },
    origins: ['tile.openstreetmap.org'],
    csp: { 'img-src': ['tile.openstreetmap.org'] },
    messages: {
      title: { en: 'OpenStreetMap maps' },
      description: { en: 'Map images loaded from OpenStreetMap servers. Loading them sends your IP address and the website you are on to OpenStreetMap.' },
    },
    notes: 'OSMF tile policy: use https://tile.openstreetmap.org/{z}/{x}/{y}.png (other hosts may be withdrawn), show the OpenStreetMap contributors attribution, and do not suppress the Referer (no Referrer-Policy: no-referrer). UNVERIFIED: OSMF documents logging of IP address and referring page but not whether tile requests set browser storage, so storage is empty here because it is unknown, not because it is none. See docs/concepts/the-catalog.md.',
  }
}
