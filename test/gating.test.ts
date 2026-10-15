import { beforeEach, describe, expect, test, vi } from 'vitest'
import { youtube, theme } from '../src/catalog'
import { clearStorage, createEmbed, hostAllowed, loadScript, unloadService } from '../src/gating'
import type { ClientEntry } from '../src/schema'

const yt = youtube()
beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; localStorage.clear(); sessionStorage.clear() })

describe('hostAllowed (review focus 3)', () => {
  test('allows exact host over https', () => expect(hostAllowed(yt, 'https://www.youtube-nocookie.com/embed/abc')).toBe(true))
  test.each([
    'https://www.youtube-nocookie.com.evil.com/embed/abc',
    'https://www.youtube-nocookie.com@evil.com/',
    'https://evil.com/www.youtube-nocookie.com',
    'http://www.youtube-nocookie.com/embed/abc',
    'https://youtube-nocookie.com/embed/abc',
    'javascript:alert(1)', 'data:text/html,x', 'not a url', '',
  ])('rejects %s', (u) => expect(hostAllowed(yt, u)).toBe(false))
})

describe('createEmbed', () => {
  test('builds a locked-down iframe', () => {
    const f = createEmbed(document, yt, 'https://www.youtube-nocookie.com/embed/abc', 'Video')
    expect(f.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/abc')
    expect(f.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin')
    expect(f.getAttribute('loading')).toBe('lazy')
    expect(f.getAttribute('sandbox')).toContain('allow-scripts')
    expect(f.getAttribute('title')).toBe('Video')
  })
  test('throws for a disallowed origin', () => {
    expect(() => createEmbed(document, yt, 'https://evil.com/x', 'v')).toThrow(/not allowed/)
  })
  test('throws for an entry that is not an iframe entry', () => {
    const noIframe: ClientEntry = { ...yt, gating: { type: 'none' } }
    expect(() => createEmbed(document, noIframe, 'https://www.youtube-nocookie.com/embed/a', 'v')).toThrow()
  })
})

describe('loadScript', () => {
  const script: ClientEntry = { ...yt, id: 'plausible', origins: ['plausible.io'], gating: { type: 'script', src: 'https://plausible.io/js/s.js' } }
  test('adds one async script and is idempotent', () => {
    loadScript(document, script); loadScript(document, script)
    const found = document.querySelectorAll('script[data-consent-service="plausible"]')
    expect(found.length).toBe(1)
    expect(found[0]!.getAttribute('async')).not.toBeNull()
    expect(found[0]!.getAttribute('src')).toBe('https://plausible.io/js/s.js')
  })
  test('refuses when the src host is not in origins', () => {
    const bad: ClientEntry = { ...script, gating: { type: 'script', src: 'https://evil.com/a.js' } }
    expect(() => loadScript(document, bad)).toThrow(/not allowed/)
  })
  test('returns null for non-script entries', () => expect(loadScript(document, yt)).toBeNull())
})

describe('clearStorage / unloadService (review focus 5)', () => {
  test('removes local and session storage items', () => {
    localStorage.setItem('theme', 'dark')
    expect(clearStorage(document, theme())).toEqual([])
    expect(localStorage.getItem('theme')).toBeNull()
  })
  test('expires a cookie and reports nothing remaining', () => {
    document.cookie = '_ga=1; Path=/'
    const e: ClientEntry = { ...yt, storage: [{ name: '_ga', type: 'cookie', expiry: yt.messages.title, purpose: yt.messages.title }] }
    expect(clearStorage(document, e)).toEqual([])
    expect(document.cookie).not.toContain('_ga=')
  })
  test('reports items it could not remove', () => {
    const e: ClientEntry = { ...yt, storage: [{ name: 'stubborn', type: 'cookie', expiry: yt.messages.title, purpose: yt.messages.title }] }
    const realCookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!
    Object.defineProperty(document, 'cookie', { configurable: true, get: () => 'stubborn=1', set: () => {} })
    const left = clearStorage(document, e)
    Object.defineProperty(document, 'cookie', realCookie as PropertyDescriptor)
    delete (document as any).cookie
    expect(left.map((s) => s.name)).toEqual(['stubborn'])
  })
  test('unloadService removes its script and clears storage', () => {
    const script: ClientEntry = { ...yt, id: 'plausible', origins: ['plausible.io'], gating: { type: 'script', src: 'https://plausible.io/js/s.js' } }
    loadScript(document, script)
    unloadService(document, script)
    expect(document.querySelector('script[data-consent-service="plausible"]')).toBeNull()
  })
  test('skips storage names that are not safe tokens and never writes them', () => {
    const set = vi.spyOn(document, 'cookie', 'set')
    const e: ClientEntry = { ...yt, storage: [{ name: 'a;Domain=x', type: 'cookie', expiry: yt.messages.title, purpose: yt.messages.title }] }
    clearStorage(document, e)
    expect(set).not.toHaveBeenCalled()
    set.mockRestore()
  })
  test('http deletion strings do not include Secure', () => {
    const set = vi.spyOn(document, 'cookie', 'set')
    const e: ClientEntry = { ...yt, storage: [{ name: '_ga', type: 'cookie', expiry: yt.messages.title, purpose: yt.messages.title }] }
    clearStorage(document, e)
    expect(set.mock.calls.length).toBeGreaterThan(0)
    expect(set.mock.calls.every(([v]) => !String(v).includes('; Secure'))).toBe(true)
    set.mockRestore()
  })
  test('an id containing a selector-breaking sequence does not throw', () => {
    const weird: ClientEntry = { ...yt, id: 'x"] , [y', gating: { type: 'script', src: 'https://www.youtube-nocookie.com/a.js' } }
    expect(() => loadScript(document, weird)).not.toThrow()
    expect(() => unloadService(document, weird)).not.toThrow()
    expect(document.querySelectorAll('script').length).toBe(0)
  })
})
