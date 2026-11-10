import { afterEach, describe, expect, test } from 'vitest'
import * as CC from 'vanilla-cookieconsent'
import { defineConsent } from '../src/config'
import { esriImagery, openStreetMap, theme, turnstile, youtube } from '../src/catalog'
import { createConsent } from '../src/client'
import { createVccDriver } from '../src/driver-vcc'
import { ConsentConfigError } from '../src/validate'
import { MAX_COOKIE_LENGTH, maxCookieBytes, readCookieValue } from '../src/state'

const generated = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({ ...youtube(), id: `${prefix}${String(i).padStart(3, '0')}`, origins: [`gen${i}.example.com`] }))
const flush = () => new Promise((r) => setTimeout(r, 20))

describe('maxCookieBytes', () => {
  afterEach(() => { CC.reset(true) })

  test.each([true, false])('agrees with the cookie the real engine writes, within 2%%, for the shipped catalog plus 40 services (service toggles %s)', async (serviceToggles) => {
    const shipped = [turnstile(), youtube(), theme(), openStreetMap(), esriImagery()]
    const conf = defineConsent({ locales: ['en'], defaultLocale: 'en', revision: 1, services: [...shipped, ...generated(40, 'generated-service-')], ui: { manager: { serviceToggles } } })
    CC.reset(true)
    const c = createConsent(conf, { driver: createVccDriver() }); c.init()
    await flush()
    if (serviceToggles) c.setServices(conf.services.filter((x) => x.category !== 'necessary').map((x) => x.id))
    else c.acceptAll()
    await flush()
    const raw = readCookieValue(document.cookie, conf.cookieName)!
    expect(raw).toBeTruthy()
    // what the browser counts: the name, the equals sign and the percent-encoded value
    const actual = conf.cookieName.length + 1 + raw.length
    const predicted = maxCookieBytes(conf)
    expect(predicted).toBeGreaterThanOrEqual(actual)
    expect((predicted - actual) / actual).toBeLessThanOrEqual(0.02)
  })

  test('grows with the cookie name', () => {
    const a = maxCookieBytes(defineConsent({ locales: ['en'], defaultLocale: 'en', revision: 1, services: [theme()] }))
    const b = maxCookieBytes(defineConsent({ locales: ['en'], defaultLocale: 'en', revision: 1, services: [theme()], cookieName: 'a_much_longer_cookie_name' }))
    expect(b - a).toBe('a_much_longer_cookie_name'.length - 'cc_cookie'.length)
  })

  test('a site without per-service toggles stores no service ids, so it is smaller', () => {
    const base = { locales: ['en'], defaultLocale: 'en', revision: 1, services: [youtube(), theme()] }
    const on = maxCookieBytes(defineConsent({ ...base }))
    const off = maxCookieBytes(defineConsent({ ...base, ui: { manager: { serviceToggles: false } } }))
    expect(off).toBeLessThan(on)
  })

  test('defineConsent rejects a config whose worst case exceeds the 4096-byte limit, naming the limit', () => {
    const input = { locales: ['en'], defaultLocale: 'en', revision: 1, services: generated(120, 'a-service-with-a-rather-long-identifier-') }
    expect(() => defineConsent(input)).toThrow(ConsentConfigError)
    expect(() => defineConsent(input)).toThrow(/services.*4096/)
    expect(() => defineConsent(input)).toThrow(/\b\d{4,6} bytes/)
  })

  test('accepts the shipped catalog plus 40 services, which fits', () => {
    const conf = defineConsent({ locales: ['en'], defaultLocale: 'en', revision: 1, services: generated(40, 'generated-service-') })
    expect(maxCookieBytes(conf)).toBeLessThanOrEqual(MAX_COOKIE_LENGTH)
  })
})
