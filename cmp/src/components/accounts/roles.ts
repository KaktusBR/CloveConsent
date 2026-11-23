// The translated name of each role (src/lib/roles.ts lists them; src/server/auth/permissions.ts says what each may do).
import { grantableRoles, type Role } from '@/lib/roles'
import { m } from '@/paraglide/messages.js'

export type RoleName = Role

const NAMES: Readonly<Record<Role, () => string>> = {
  owner: m.role_owner,
  admin: m.role_admin,
  editor: m.role_editor,
  viewer: m.role_viewer,
}

export const roleName = (role: Role): string => NAMES[role]()

/** The roles a member with `role` may give. */
export const assignableRoles = grantableRoles
