import type { Category, ClientEntry } from '../schema'
import { CATALOG } from './helpers'

const PIXEL_ID = /^[0-9]{5,20}$/

/** Meta (Facebook) Pixel. The library loads fbevents.js after consent and runs the fbq setup itself (`init: { kind: 'fbq' }`). */
export function metaPixel(o: { pixelId: string; category?: Category }): ClientEntry {
  const id = o?.pixelId
  if (typeof id !== 'string' || !PIXEL_ID.test(id)) {
    throw new Error('metaPixel: pixelId must be 5 to 20 digits (a Meta pixel ID)')
  }
  return {
    ...CATALOG, kind: 'client', id: 'meta-pixel', catalogRevision: 1, lastVerified: null,
    category: o.category ?? 'marketing',
    provider: { name: 'Meta', privacyUrl: 'https://www.facebook.com/privacy/policy/' },
    storage: [
      { name: '_fbp', type: 'cookie', expiry: { en: '90 days' }, purpose: { en: 'Identifies the browser so Meta can measure and target advertising.' } },
    ],
    gating: { type: 'script', src: 'https://connect.facebook.net/en_US/fbevents.js', init: { kind: 'fbq', id } },
    origins: ['connect.facebook.net'],
    csp: { 'connect-src': ['www.facebook.com'], 'img-src': ['www.facebook.com'] },
    messages: {
      title: { en: 'Meta Pixel' },
      description: { en: 'Measures and targets advertising on Facebook and Instagram. Visit data is sent to Meta.' },
    },
    notes: 'UNVERIFIED: hosts, the _fbp cookie and its 90-day lifetime are from memory and were not checked against Meta documentation. Meta may use other hosts or cookies (for example _fbc when a click ID is present), which are not listed here. See docs/concepts/the-catalog.md.',
  }
}
