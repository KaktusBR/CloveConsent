// The Security page's list of the person's signed-in browsers. A super-admin's support view among them
// (src/server/auth/impersonation.ts marks it in Better Auth's session list) shows as such, translated,
// with nothing about who opened it or from where.
import { m } from '../../paraglide/messages.js'

/** A session as Better Auth's session list gives it to the page. */
export interface ListedSession {
  id: string
  userAgent?: string | null | undefined
  ipAddress?: string | null | undefined
  supportView?: boolean | undefined
  updatedAt: Date
}

export interface SessionItem {
  id: string
  current: boolean
  device: string | null
  address: string | null
  lastActive: string
}

/** The rows the page shows, most recently active first; never a token. */
export function sessionItems(sessions: readonly ListedSession[], currentId: string, format: (d: Date) => string): SessionItem[] {
  return [...sessions]
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .map((s) => ({
      id: s.id,
      current: s.id === currentId,
      device: s.supportView ? m.security_session_support_view() : s.userAgent || null,
      address: s.supportView ? null : s.ipAddress || null,
      lastActive: format(s.updatedAt),
    }))
}
