// The roles of an account member: the one list the schema's check, the permissions, the server's scope
// and the pages use (src/server/auth/permissions.ts says what each may do). Plain data, safe in islands.

export const ROLES = ['owner', 'admin', 'editor', 'viewer'] as const

export type Role = (typeof ROLES)[number]

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/** The roles a member with `role` may give (invite with, or change another member to): an owner any, an admin any but owner, others none. */
export function grantableRoles(role: Role): Role[] {
  if (role === 'owner') return [...ROLES]
  if (role === 'admin') return ['admin', 'editor', 'viewer']
  return []
}
