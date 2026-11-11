// The sites behind site.html and blocking.html, each served as one script by the real buildSiteScript.
import { googleAnalytics, metaPixel, openStreetMap, youtube } from '../../src/catalog'
import { defineConsent } from '../../src/config'
import { buildSiteScript } from '../../src/site-script'
import type { ClientEntry } from '../../src/schema'

export const TRACKER_HOST = 'tracker.cloveconsent.test'
export const WIDGET_HOST = 'widget.cloveconsent.test'

const tracker: ClientEntry = {
  kind: 'client', id: 'tracker', catalogRevision: 1, lastVerified: null, category: 'analytics',
  provider: { name: 'Tracker', privacyUrl: `https://${TRACKER_HOST}/privacy` },
  storage: [], gating: { type: 'none' }, origins: [TRACKER_HOST],
  messages: { title: { en: 'Tracker' }, description: { en: 'A fake tracker for the browser tests.' } },
}

// a third-party widget: a marked loader script that renders into a container the page leaves empty
const widget: ClientEntry = {
  kind: 'client', id: 'widget', catalogRevision: 1, lastVerified: null, category: 'functional',
  provider: { name: 'Widget', privacyUrl: `https://${WIDGET_HOST}/privacy` },
  storage: [], gating: { type: 'none' }, origins: [WIDGET_HOST],
  messages: { title: { en: 'Widget' }, description: { en: 'A fake widget for the browser tests.' } },
}

/** Builds a site script with the development warning about services outside the catalog silenced (expected here). */
async function quietly(build: () => Promise<string>): Promise<string> {
  const warn = console.warn
  console.warn = () => {}
  try { return await build() } finally { console.warn = warn }
}

export async function siteScript(): Promise<string> {
  return quietly(() => {
    const config = defineConsent({ locales: ['en'], defaultLocale: 'en', revision: 1, services: [tracker, youtube()] })
    return buildSiteScript({ site: 'browser-site', config })
  })
}

/** The site of the end-to-end blocking suite: real catalog entries for video, maps, analytics and a pixel, plus the widget. */
export async function blockingSiteScript(): Promise<string> {
  return quietly(() => {
    const config = defineConsent({
      locales: ['en'], defaultLocale: 'en', revision: 1,
      services: [youtube(), openStreetMap(), googleAnalytics({ measurementId: 'G-TEST1234' }), metaPixel({ pixelId: '1234567' }), widget],
    })
    return buildSiteScript({ site: 'blocking-site', config, reportUrl: '/report' })
  })
}
