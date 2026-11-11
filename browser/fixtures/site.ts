// The site behind site.html: a fake tracker (analytics) and YouTube, served as one script by the real buildSiteScript.
import { youtube } from '../../src/catalog'
import { defineConsent } from '../../src/config'
import { buildSiteScript } from '../../src/site-script'
import type { ClientEntry } from '../../src/schema'

export const TRACKER_HOST = 'tracker.cloveconsent.test'

const tracker: ClientEntry = {
  kind: 'client', id: 'tracker', catalogRevision: 1, lastVerified: null, category: 'analytics',
  provider: { name: 'Tracker', privacyUrl: `https://${TRACKER_HOST}/privacy` },
  storage: [], gating: { type: 'none' }, origins: [TRACKER_HOST],
  messages: { title: { en: 'Tracker' }, description: { en: 'A fake tracker for the browser tests.' } },
}

export async function siteScript(): Promise<string> {
  // the development warning about a service outside the catalog is expected here
  const warn = console.warn
  console.warn = () => {}
  try {
    const config = defineConsent({ locales: ['en'], defaultLocale: 'en', revision: 1, services: [tracker, youtube()] })
    return await buildSiteScript({ site: 'browser-site', config })
  } finally { console.warn = warn }
}
