import { beforeEach, describe, expect, test } from 'vitest'
import { defineConsent } from '../src/config'
import { buildView } from '../src/view'
import { googleAnalytics, youtube } from '../src/catalog'
import { measure, mountPlaceholder, renderPlaceholder } from '../src/placeholder'
import sk from '../src/locales/sk'

const config = defineConsent({ locales: ['sk', 'en'], defaultLocale: 'en', packs: [sk], revision: 1, services: [youtube(), googleAnalytics({ measurementId: 'G-ABCDEF1234' })] })
const en = buildView(config, 'en')
const html = (id: string, label?: string, view = en) => {
  const host = document.createElement('div')
  host.innerHTML = renderPlaceholder(view, id, label)
  return host
}

describe('renderPlaceholder', () => {
  test('is one div.consent-placeholder tagged with the service id and carrying the blocked text, hint and category', () => {
    const host = html('youtube')
    const ph = host.querySelector('.consent-placeholder')!
    expect(host.children).toHaveLength(1)
    expect(ph.tagName).toBe('DIV')
    expect(ph.getAttribute('data-consent-placeholder-for')).toBe('youtube')
    const text = ph.querySelector('p.consent-placeholder__text')!
    expect(text.textContent).toBe('YouTube videos is turned off because of your cookie choice. Turn on Media cookies to see it.')
  })
  test('names the translated category in the other languages', () => {
    const skView = buildView(config, 'sk')
    const text = html('youtube', undefined, skView).querySelector('.consent-placeholder__text')!.textContent!
    expect(text).toContain(skView.m.catMedia)
    expect(text).not.toContain('{')
  })
  test('has an accept button labelled with embedAllow and a once button for an iframe service', () => {
    const host = html('youtube')
    expect(host.querySelector('[data-consent-action="accept"]')!.textContent).toBe('Allow YouTube videos')
    expect(host.querySelector('[data-consent-action="once"]')!.textContent).toBe('Load once')
  })
  test('has no once button for a script service', () => {
    const host = html('google-analytics')
    expect(host.querySelector('[data-consent-action="once"]')).toBeNull()
    expect(host.querySelector('[data-consent-action="accept"]')).not.toBeNull()
  })
  test('has a settings link wired to the existing data-consent-open convention', () => {
    const open = html('youtube').querySelector('[data-consent-open]')!
    expect(open.textContent).toBe(en.m.reopen)
    expect((open as HTMLButtonElement).type).toBe('button')
  })
  test('uses the label for the service name when given, escaped', () => {
    const host = html('youtube', '<img src=x onerror=alert(1)> & "q"')
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('[data-consent-action="accept"]')!.textContent).toBe('Allow <img src=x onerror=alert(1)> & "q"')
    expect(host.querySelector('.consent-placeholder__text')!.textContent).toContain('<img src=x onerror=alert(1)> & "q" is turned off')
  })
  test('escapes a service id in the attribute', () => {
    const view = { ...en, categories: en.categories.map((c) => ({ ...c, services: c.services.map((s) => (s.id === 'youtube' ? { ...s, id: 'a"b' } : s)) })) }
    const host = html('a"b', undefined, view)
    expect(host.querySelector('.consent-placeholder')!.getAttribute('data-consent-placeholder-for')).toBe('a"b')
    expect(host.querySelectorAll('[data-consent-placeholder-for]')).toHaveLength(1)
  })
  test('throws for a service that is not in the view', () => {
    expect(() => renderPlaceholder(en, 'nope')).toThrow(/nope/)
  })
})

describe('measure', () => {
  const rect = (w: number, h: number) => ({ x: 0, y: 0, top: 0, left: 0, right: w, bottom: h, width: w, height: h, toJSON: () => ({}) }) as DOMRect
  test('reads width and height attributes as px', () => {
    const el = document.createElement('iframe')
    el.setAttribute('width', '560'); el.setAttribute('height', '315')
    expect(measure(el)).toEqual({ width: '560px', height: '315px' })
  })
  test('keeps a percentage attribute', () => {
    const el = document.createElement('iframe')
    el.setAttribute('width', '100%'); el.setAttribute('height', '315')
    expect(measure(el)).toEqual({ width: '100%', height: '315px' })
  })
  test('falls back to the rendered size', () => {
    const el = document.createElement('div')
    el.getBoundingClientRect = () => rect(300, 150)
    expect(measure(el)).toEqual({ width: '300px', height: '150px' })
  })
  test('falls back per side when only one attribute is usable', () => {
    const el = document.createElement('iframe')
    el.setAttribute('width', 'auto')
    el.getBoundingClientRect = () => rect(400, 200)
    expect(measure(el)).toEqual({ width: '400px', height: '200px' })
  })
  test('returns null for 0x0', () => {
    expect(measure(document.createElement('div'))).toBeNull()
  })
})

describe('mountPlaceholder', () => {
  let target: HTMLElement
  beforeEach(() => {
    document.body.innerHTML = '<section><iframe id="t"></iframe></section>'
    target = document.getElementById('t')!
  })
  test('replaces the target with the placeholder and returns it', () => {
    const ph = mountPlaceholder(target, renderPlaceholder(en, 'youtube'), { width: '560px', height: '315px' })
    expect(document.getElementById('t')).toBeNull()
    expect(ph.parentElement!.tagName).toBe('SECTION')
    expect(ph.getAttribute('data-consent-placeholder-for')).toBe('youtube')
    expect(ph.style.inlineSize).toBe('560px')
    expect(ph.style.blockSize).toBe('315px')
    expect(ph.classList.contains('consent-placeholder--min')).toBe(false)
  })
  test('a null size applies the minimum size class', () => {
    const ph = mountPlaceholder(target, renderPlaceholder(en, 'youtube'), null)
    expect(ph.classList.contains('consent-placeholder--min')).toBe(true)
    expect(ph.getAttribute('style')).toBeNull()
  })
})
