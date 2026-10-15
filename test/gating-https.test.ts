// @vitest-environment-options { "url": "https://example.com/" }
import { describe, expect, test, vi } from 'vitest'
import { youtube } from '../src/catalog'
import { clearStorage } from '../src/gating'
import type { ClientEntry } from '../src/schema'

describe('clearStorage on https', () => {
  test('deletion strings include Secure so __Host-/__Secure- cookies can expire', () => {
    const yt = youtube()
    const e: ClientEntry = { ...yt, storage: [{ name: '__Host-sid', type: 'cookie', expiry: yt.messages.title, purpose: yt.messages.title }] }
    const set = vi.spyOn(document, 'cookie', 'set')
    clearStorage(document, e)
    expect(set.mock.calls.length).toBeGreaterThan(0)
    expect(set.mock.calls.every(([v]) => String(v).includes('; Secure'))).toBe(true)
    set.mockRestore()
  })
})
