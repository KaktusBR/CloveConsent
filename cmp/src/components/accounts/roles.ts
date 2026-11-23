// The translated name of each role (src/server/auth/permissions.ts says what each may do).
import { m } from '@/paraglide/messages.js'

export type RoleName = 'owner' | 'admin' | 'editor' | 'viewer'

const NAMES: Readonly<Record<RoleName, () => string>> = {
  owner: m.role_owner,
  admin: m.role_admin,
  editor: m.role_editor,
  viewer: m.role_viewer,
}

export const roleName = (role: RoleName): string => NAMES[role]()

/** The roles a member with `role` may give: an owner any, an admin any but owner. */
export const assignableRoles = (role: RoleName): RoleName[] => (role === 'owner' ? ['owner', 'admin', 'editor', 'viewer'] : ['admin', 'editor', 'viewer'])
