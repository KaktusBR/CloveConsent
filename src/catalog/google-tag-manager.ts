import type { Category, ClientEntry } from '../schema'
import { CATALOG } from './helpers'

const CONTAINER_ID = /^GTM-[A-Z0-9]{4,10}$/

/**
 * Google Tag Manager. This gates the container script as a whole. Tags inside the container are the site owner's
 * responsibility, so the default category is `marketing`.
 */
export function googleTagManager(o: { containerId: string; category?: Category }): ClientEntry {
  const id = o?.containerId
  if (typeof id !== 'string' || !CONTAINER_ID.test(id)) {
    throw new Error('googleTagManager: containerId must look like GTM-XXXXXXX (a Tag Manager container ID)')
  }
  return {
    ...CATALOG, kind: 'client', id: 'google-tag-manager', catalogRevision: 1, lastVerified: null,
    category: o.category ?? 'marketing',
    provider: { name: 'Google', privacyUrl: 'https://policies.google.com/privacy' },
    storage: [],
    gating: { type: 'script', src: `https://www.googletagmanager.com/gtm.js?id=${id}`, init: { kind: 'gtm' } },
    origins: ['www.googletagmanager.com'],
    csp: { 'script-src': ['www.googletagmanager.com'] },
    messages: {
      title: { en: 'Google Tag Manager' },
      description: { en: 'Loads the website tags (for example analytics or advertising) from Google Tag Manager.' },
    },
    notes: 'Tags inside the container are not gated individually by this library: the whole container loads only when this service is allowed. UNVERIFIED: storage is empty because it is unknown, not because it is none; what is stored and which hosts are contacted depend on the tags in the container, so list them and extend the CSP yourself. Hosts were not checked against Google documentation. See docs/concepts/the-catalog.md.',
  }
}
