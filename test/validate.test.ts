import { describe, expect, test } from 'vitest'
import { ConsentConfigError, assertHost, assertLocalised, assertText, assertUrl, validateProcessor, validateService } from '../src/validate'

const L = (v: string) => ({ sk: v, en: v, fr: v, de: v })

describe('assertText', () => {
  test('accepts plain text', () => expect(() => assertText('Ahoj & čau', 'x')).not.toThrow())
  test.each(['<b>x</b>', 'a>b', 'x\u0000y', '   ', '', 'a\tb', 'a\nb', 'a\rb'])('rejects %j', (v) => {
    expect(() => assertText(v, 'x')).toThrow(ConsentConfigError)
  })
  test('rejects non-strings and overlong', () => {
    expect(() => assertText(5, 'x')).toThrow()
    expect(() => assertText('a'.repeat(601), 'x')).toThrow()
  })
})

describe('assertUrl', () => {
  test.each(['https://example.com/p', '/privacy', '/a/b?c=1'])('accepts %s', (v) => {
    expect(() => assertUrl(v, 'x')).not.toThrow()
  })
  test.each(['http://example.com', 'javascript:alert(1)', 'data:text/html,x', '//evil.com', '/\\evil.com',
    'https://user:pw@example.com', 'https://', 'ftp://x.com',
    '/\t/x', '/\n/x', '/\r/x', ' https://a.com', 'https://a.com/a b'])('rejects %s', (v) => {
    expect(() => assertUrl(v, 'x')).toThrow(ConsentConfigError)
  })
})

describe('assertHost', () => {
  test('accepts hostnames', () => expect(() => assertHost('www.youtube-nocookie.com', 'x')).not.toThrow())
  test.each(['https://a.com', 'a.com/path', 'A.COM', 'localhost', 'a b.com', '*.a.com', ''])('rejects %j', (v) => {
    expect(() => assertHost(v, 'x')).toThrow()
  })
})

describe('assertLocalised', () => {
  test('requires every enabled locale, non-empty', () => {
    expect(() => assertLocalised(L('x'), 'p', ['sk', 'en'])).not.toThrow()
    expect(() => assertLocalised({ sk: 'x', en: '  ' }, 'p', ['sk', 'en'])).toThrow(/p\.en/)
    expect(() => assertLocalised({ sk: 'x' }, 'p', ['sk', 'en'])).toThrow(/p\.en/)
    expect(() => assertLocalised(L('x'), 'p', ['sk', 'xx' as any])).toThrow(/p\.xx/)
  })
})

describe('validateService', () => {
  const base = {
    kind: 'first-party', id: 'branch-choice', catalogRevision: 1, lastVerified: null, category: 'functional',
    storage: [{ name: 'branch', type: 'sessionStorage', expiry: L('session'), purpose: L('Remembers branch') }],
    messages: { title: L('Branch'), description: L('Remembers your branch choice') },
  } as const
  test('accepts a valid entry', () => expect(() => validateService(structuredClone(base) as any, ['sk', 'en'], 'e')).not.toThrow())
  test('rejects bad id', () => {
    expect(() => validateService({ ...structuredClone(base), id: 'Bad Id"><x' } as any, ['sk'], 'e')).toThrow(/id/)
  })
  test('rejects html in a locale (review focus 2)', () => {
    const e = structuredClone(base) as any
    e.messages.description.en = '<img src=x onerror=alert(1)>'
    expect(() => validateService(e, ['sk', 'en'], 'e')).toThrow(/plain text/)
  })
  test('rejects whitespace-only locale value (review focus 2)', () => {
    const e = structuredClone(base) as any
    e.messages.title.sk = '   '
    expect(() => validateService(e, ['sk', 'en'], 'e')).toThrow()
  })
  test('rejects bad storage name', () => {
    const e = structuredClone(base) as any
    e.storage[0].name = 'a;b=c'
    expect(() => validateService(e, ['sk'], 'e')).toThrow(/name/)
  })
  test('client script src host must be in origins', () => {
    const e: any = {
      kind: 'client', id: 'x', catalogRevision: 1, lastVerified: null, category: 'analytics',
      provider: { name: 'X', privacyUrl: 'https://x.com/p' }, storage: [],
      gating: { type: 'script', src: 'https://evil.com/a.js' }, origins: ['cdn.x.com'],
      messages: { title: L('X'), description: L('X') },
    }
    expect(() => validateService(e, ['sk'], 'e')).toThrow(/origins/)
    e.gating.src = 'https://cdn.x.com/a.js'
    expect(() => validateService(e, ['sk'], 'e')).not.toThrow()
  })

  const client = (): any => ({
    kind: 'client', id: 'x', catalogRevision: 1, lastVerified: null, category: 'analytics',
    provider: { name: 'X', privacyUrl: 'https://x.com/p' }, storage: [],
    gating: { type: 'none' }, origins: ['cdn.x.com'],
    messages: { title: L('X'), description: L('X') },
  })
  test('script src must be absolute https without port', () => {
    for (const src of ['/a.js', 'https://cdn.x.com:8443/a.js']) {
      const e = client(); e.gating = { type: 'script', src }
      expect(() => validateService(e, ['sk'], 'e')).toThrow(ConsentConfigError)
    }
  })
  test('iframe sandbox', () => {
    const e = client(); e.gating = { type: 'iframe', sandbox: 'allow-scripts allow-same-origin' }
    expect(() => validateService(e, ['sk'], 'e')).not.toThrow()
    e.gating.sandbox = '<x>'
    expect(() => validateService(e, ['sk'], 'e')).toThrow(/sandbox/)
  })
  test('notes must be plain text', () => {
    const e = client(); e.notes = '<b>x</b>'
    expect(() => validateService(e, ['sk'], 'e')).toThrow(/notes/)
  })
  test('unreviewed must be known locales', () => {
    const e = client(); e.unreviewed = ['sk']
    expect(() => validateService(e, ['sk'], 'e')).not.toThrow()
    e.unreviewed = ['zz']
    expect(() => validateService(e, ['sk'], 'e')).toThrow(/unreviewed/)
  })
  test('csp validation', () => {
    const e = client(); e.csp = { 'img-src': 'a.com' }
    expect(() => validateService(e, ['sk'], 'e')).toThrow(ConsentConfigError)
    e.csp = { 'img-src': ['a.com'] }
    expect(() => validateService(e, ['sk'], 'e')).not.toThrow()
    e.csp = { 'font-src': ['a.com'] }
    expect(() => validateService(e, ['sk'], 'e')).toThrow(/unknown directive/)
    e.csp = []
    expect(() => validateService(e, ['sk'], 'e')).toThrow(/csp/)
  })
  test('bad lastVerified and category', () => {
    const e = client(); e.lastVerified = '14-10-2026'
    expect(() => validateService(e, ['sk'], 'e')).toThrow(/lastVerified/)
    const f = client(); f.category = 'bogus'
    expect(() => validateService(f, ['sk'], 'e')).toThrow(/category/)
  })
})

describe('validateProcessor', () => {
  const proc = (): any => ({
    kind: 'processor', id: 'mailer', catalogRevision: 1, lastVerified: null,
    provider: { name: 'M', privacyUrl: 'https://m.com/p' }, purpose: L('Sends mail'),
    dataCategories: [L('Email')], location: L('EU'), dpaUrl: 'https://m.com/dpa',
  })
  test('accepts valid', () => expect(() => validateProcessor(proc(), ['sk', 'en'], 'p')).not.toThrow())
  test('rejects html in purpose', () => {
    const e = proc(); e.purpose.en = '<b>x</b>'
    expect(() => validateProcessor(e, ['sk', 'en'], 'p')).toThrow(/plain text/)
  })
  test('rejects bad dpaUrl', () => {
    const e = proc(); e.dpaUrl = 'http://m.com/dpa'
    expect(() => validateProcessor(e, ['sk'], 'p')).toThrow(/dpaUrl/)
  })
})

describe('hardening', () => {
  const L = (v: string) => ({ sk: v, en: v, fr: v, de: v })
  const base = {
    kind: 'first-party', id: 'branch-choice', catalogRevision: 1, lastVerified: null, category: 'functional',
    storage: [{ name: 'branch', type: 'sessionStorage', expiry: L('session'), purpose: L('Remembers branch') }],
    messages: { title: L('Branch'), description: L('Remembers your branch choice') },
  } as const
  test.each(['2026-13-45', '2026-02-30', '2026-00-10', '2025-02-29'])('rejects the non-date %s', (d) => {
    const e: any = structuredClone(base); e.lastVerified = d
    expect(() => validateService(e, ['sk', 'en'], 'e')).toThrow(/lastVerified/)
  })
  test.each(['2026-02-28', '2024-02-29'])('accepts the real date %s', (d) => {
    const e: any = structuredClone(base); e.lastVerified = d
    expect(() => validateService(e, ['sk', 'en'], 'e')).not.toThrow()
  })
  test('accepts punycode top-level domains', () => {
    expect(() => assertHost('example.xn--p1ai', 'h')).not.toThrow()
    expect(() => assertHost('shop.xn--vermgensberatung-pwb', 'h')).not.toThrow()
  })
  test('still rejects bad hosts', () => {
    for (const h of ['xn--p1ai', 'example.', 'example.c', 'Example.com', 'a b.com']) expect(() => assertHost(h, 'h')).toThrow()
  })
  test('rejects sandbox on non-iframe gating', () => {
    const e: any = {
      kind: 'client', id: 'x', catalogRevision: 1, lastVerified: null, category: 'analytics',
      provider: { name: 'X', privacyUrl: 'https://x.com/p' }, storage: [],
      gating: { type: 'none', sandbox: 'allow-scripts' }, origins: ['cdn.x.com'],
      messages: { title: L('X'), description: L('X') },
    }
    expect(() => validateService(e, ['sk'], 'e')).toThrow(/sandbox/)
  })
})
