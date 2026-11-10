// Test-only stand-in for the standalone runtime (Ruling R2): bundled to a classic IIFE in globalSetup and loaded as the first
// script in <head> of the fixture pages, wired the way a standalone boot will be. Task 6 replaces it with the real bundle.
import { installAutoBlocking } from '../../src/autoblock'
import { createConsent } from '../../src/client'
import { defineConsent } from '../../src/config'
import { createVccDriver } from '../../src/driver-vcc'
import { bindMarked, syncMarked } from '../../src/marked'
import { youtube } from '../../src/catalog'
import type { ClientEntry } from '../../src/schema'

export const TRACKER_HOST = 'tracker.cloveconsent.test'

const tracker: ClientEntry = {
  kind: 'client', id: 'tracker', catalogRevision: 1, lastVerified: null, category: 'analytics',
  provider: { name: 'Tracker', privacyUrl: `https://${TRACKER_HOST}/privacy` },
  storage: [], gating: { type: 'none' }, origins: [TRACKER_HOST],
  messages: { title: { en: 'Tracker' }, description: { en: 'A fake tracker for the browser tests.' } },
}
const config = defineConsent({ locales: ['en'], defaultLocale: 'en', revision: 1, services: [tracker, youtube()] })
const consent = createConsent(config, { driver: createVccDriver() })

// auto-blocking first and synchronously: everything after this script in the page is within its reach
const blocking = installAutoBlocking(document, {
  serviceForHost: (host) => config.services.find((s) => s.kind === 'client' && s.origins.includes(host))?.id ?? null,
  // persisted consent only, as marked scripts (Ruling R6); one-time allowances come through release()
  isAllowed: (id) => {
    const entry = config.services.find((s) => s.id === id)
    return !!entry && (entry.category === 'necessary' || consent.acceptedServices().includes(id))
  },
  // a blocked iframe gets its placeholder once it is in the page
  onBlocked: () => { queueMicrotask(() => syncMarked(consent, document)) },
})
consent.on('once', (id) => blocking.release(id))

const start = () => {
  consent.init()
  bindMarked(consent, document)
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
else start()
