// The Security page's list of signed-in browsers (src/components/auth/sessions.ts): a super-admin's
// support view among the member's sessions shows as such, translated, with nothing about who or where.
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { sessionItems } from '../../src/components/auth/sessions'

const en = JSON.parse(readFileSync('messages/en.json', 'utf8')) as Record<string, string>
const format = (d: Date) => d.toISOString()

describe('the Security page sessions', () => {
  test('a support view is labelled as one, without a browser or an address; the others keep theirs', () => {
    const items = sessionItems(
      [
        { id: 'own', userAgent: 'Firefox', ipAddress: '192.0.2.1', updatedAt: new Date('2026-11-20T10:00:00Z') },
        { id: 'view', userAgent: null, ipAddress: null, supportView: true, updatedAt: new Date('2026-11-21T10:00:00Z') },
      ],
      'own',
      format,
    )
    expect(items).toEqual([
      { id: 'view', current: false, device: en.security_session_support_view, address: null, lastActive: '2026-11-21T10:00:00.000Z' },
      { id: 'own', current: true, device: 'Firefox', address: '192.0.2.1', lastActive: '2026-11-20T10:00:00.000Z' },
    ])
  })

  test('even if a view still carried its browser and address, they are not shown', () => {
    const [item] = sessionItems([{ id: 'v', userAgent: 'Chrome', ipAddress: '198.51.100.7', supportView: true, updatedAt: new Date(0) }], 'x', format)
    expect(item).toMatchObject({ device: en.security_session_support_view, address: null })
  })
})
