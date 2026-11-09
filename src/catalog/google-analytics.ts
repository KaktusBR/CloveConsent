import type { Category, ClientEntry } from '../schema'
import { CATALOG } from './helpers'

const MEASUREMENT_ID = /^G-[A-Z0-9]{4,20}$/

/**
 * Google Analytics 4 through gtag.js. The library loads the script after consent and runs the gtag setup itself
 * (`init: { kind: 'gtag' }`), so the site needs no inline snippet.
 */
export function googleAnalytics(o: { measurementId: string; category?: Category }): ClientEntry {
  const id = o?.measurementId
  if (typeof id !== 'string' || !MEASUREMENT_ID.test(id)) {
    throw new Error('googleAnalytics: measurementId must look like G-XXXXXXXXXX (a GA4 measurement ID)')
  }
  return {
    ...CATALOG, kind: 'client', id: 'google-analytics', catalogRevision: 1, lastVerified: null,
    category: o.category ?? 'analytics',
    provider: { name: 'Google', privacyUrl: 'https://policies.google.com/privacy' },
    storage: [
      { name: '_ga', type: 'cookie', expiry: { en: '2 years' }, purpose: { en: 'Distinguishes visitors to measure site usage.' } },
      { name: `_ga_${id.slice(2)}`, translationKey: '_ga_container', type: 'cookie', expiry: { en: '2 years' }, purpose: { en: 'Keeps session state for this Google Analytics property.' } },
    ],
    gating: { type: 'script', src: `https://www.googletagmanager.com/gtag/js?id=${id}`, init: { kind: 'gtag', id } },
    origins: ['www.googletagmanager.com'],
    csp: { 'connect-src': ['www.google-analytics.com', 'analytics.google.com'], 'img-src': ['www.google-analytics.com'] },
    messages: {
      title: { en: 'Google Analytics' },
      description: { en: 'Measures how the site is used (pages viewed, visit length). Data is sent to Google.' },
    },
    notes: 'UNVERIFIED: hosts, cookie names and the 2-year lifetimes are from memory and were not checked against Google developer documentation. Google may also use regional hosts (for example region1.google-analytics.com), which are not listed here: add them to the CSP yourself if your property needs them. Not checked: whether Google Signals or advertising features set more storage. See docs/concepts/the-catalog.md.',
  }
}
