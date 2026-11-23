// What each role of an account may do. The product's statement (its resources and their actions) is
// written with Better Auth's access-control builder; later plans check it with `can` for their routes
// (sites, records, billing). Better Auth's organization plugin gets the same roles, translated to its own
// resources (organizationRoles), so its server-side checks agree with ours.
import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements } from 'better-auth/plugins/organization/access'
import { ROLES } from '../data/schema/auth'
import type { AccountScope, Role } from '../data/scope'

/** The product's resources and their actions. */
export const statement = {
  site: ['create', 'update', 'publish', 'delete'],
  records: ['read', 'export', 'delete'],
  member: ['invite', 'update', 'remove'],
  billing: ['manage'],
  account: ['update', 'delete'],
} as const

export type Resource = keyof typeof statement
export type Action<R extends Resource> = (typeof statement)[R][number]
type Grants = { [R in Resource]?: Action<R>[] }

const ac = createAccessControl(statement)

/**
 * The roles: an owner may do everything; an admin everything but billing and deleting the account; an
 * editor works on sites and reads records; a viewer reads records. That an account always keeps an owner
 * is enforced by the database (drizzle/0006_accounts.sql).
 */
export const GRANTS: Readonly<Record<Role, Grants>> = {
  owner: {
    site: ['create', 'update', 'publish', 'delete'],
    records: ['read', 'export', 'delete'],
    member: ['invite', 'update', 'remove'],
    billing: ['manage'],
    account: ['update', 'delete'],
  },
  admin: {
    site: ['create', 'update', 'publish', 'delete'],
    records: ['read', 'export', 'delete'],
    member: ['invite', 'update', 'remove'],
    account: ['update'],
  },
  editor: { site: ['create', 'update', 'publish'], records: ['read'] },
  viewer: { records: ['read'] },
}

const roles = Object.fromEntries(ROLES.map((role) => [role, ac.newRole(GRANTS[role])])) as Record<Role, ReturnType<typeof ac.newRole>>

/** Whether the member in `scope` may do `action` on `resource` in their account. No scope, no permission. */
export function can<R extends Resource>(scope: AccountScope | null | undefined, resource: R, action: Action<R>): boolean {
  if (!scope || !isRole(scope.role)) return false
  return roles[scope.role].authorize({ [resource]: [action] }).success
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

/** The same roles in the organization plugin's terms (its statement names other resources and actions). */
const organizationAc = createAccessControl(defaultStatements)
function organizationRole(role: Role) {
  const g = GRANTS[role]
  const member = g.member ?? []
  return organizationAc.newRole({
    organization: [...(g.account ?? [])],
    member: [...(member.includes('invite') ? (['create'] as const) : []), ...(member.includes('update') ? (['update'] as const) : []), ...(member.includes('remove') ? (['delete'] as const) : [])],
    invitation: member.includes('invite') ? ['create', 'cancel'] : [],
    team: [],
    ac: [],
  })
}
export const organizationRoles = Object.fromEntries(ROLES.map((role) => [role, organizationRole(role)])) as Record<Role, ReturnType<typeof organizationRole>>
