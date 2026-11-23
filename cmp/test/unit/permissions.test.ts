// The role matrix: every (role, resource, action) of the product's statement, against a table written out
// here by hand (not derived from the code under test).
import { describe, expect, test } from 'vitest'
import { can, organizationRoles, statement, type Action, type Resource } from '../../src/server/auth/permissions'
import type { AccountScope, Role } from '../../src/server/data/scope'
import { pathForLog } from '../../src/server/log'

const ALLOWED: Record<Role, string[]> = {
  owner: [
    'site:create', 'site:update', 'site:publish', 'site:delete',
    'records:read', 'records:export', 'records:delete',
    'member:invite', 'member:update', 'member:remove',
    'billing:manage',
    'account:update', 'account:delete',
  ],
  admin: [
    'site:create', 'site:update', 'site:publish', 'site:delete',
    'records:read', 'records:export', 'records:delete',
    'member:invite', 'member:update', 'member:remove',
    'account:update',
  ],
  editor: ['site:create', 'site:update', 'site:publish', 'records:read'],
  viewer: ['records:read'],
}

const scope = (role: Role): AccountScope => ({ accountId: '00000000-0000-4000-8000-000000000001', userId: '00000000-0000-4000-8000-000000000002', role })
const pairs = Object.entries(statement).flatMap(([resource, actions]) => actions.map((action) => [resource, action] as const))

describe('the role matrix', () => {
  test('the statement is exactly the product resources and actions', () => {
    expect(pairs.map(([r, a]) => `${r}:${a}`)).toEqual([
      'site:create', 'site:update', 'site:publish', 'site:delete',
      'records:read', 'records:export', 'records:delete',
      'member:invite', 'member:update', 'member:remove',
      'billing:manage',
      'account:update', 'account:delete',
    ])
  })

  for (const role of ['owner', 'admin', 'editor', 'viewer'] as const) {
    test.each(pairs)(`${role} → %s:%s`, (resource, action) => {
      expect(can(scope(role), resource as Resource, action as Action<Resource>)).toBe(ALLOWED[role].includes(`${resource}:${action}`))
    })
  }

  test('no scope, or a role that is not one of ours, may do nothing', () => {
    for (const [resource, action] of pairs) {
      expect(can(null, resource as Resource, action as Action<Resource>)).toBe(false)
      expect(can(undefined, resource as Resource, action as Action<Resource>)).toBe(false)
      expect(can({ ...scope('owner'), role: 'member' as Role }, resource as Resource, action as Action<Resource>)).toBe(false)
    }
  })

  test("the organization plugin's roles say the same in its terms", () => {
    const allowed = (role: Role, permissions: Record<string, string[]>) => organizationRoles[role].authorize(permissions as never).success
    for (const role of ['owner', 'admin'] as const) {
      expect(allowed(role, { invitation: ['create', 'cancel'], member: ['create', 'update', 'delete'], organization: ['update'] })).toBe(true)
    }
    expect(allowed('owner', { organization: ['delete'] })).toBe(true)
    expect(allowed('admin', { organization: ['delete'] })).toBe(false)
    for (const role of ['editor', 'viewer'] as const) {
      for (const permissions of [{ invitation: ['create'] }, { invitation: ['cancel'] }, { member: ['update'] }, { member: ['delete'] }, { organization: ['update'] }]) {
        expect(allowed(role, permissions)).toBe(false)
      }
    }
  })
})

describe('request log paths', () => {
  test("an invitation link's token never reaches the log, in any language", () => {
    expect(pathForLog('/invite/abcDEF123_-')).toBe('/invite/:token')
    expect(pathForLog('/sk/invite/abcDEF123_-')).toBe('/sk/invite/:token')
    expect(pathForLog('/SK/Invite/abc/def')).toBe('/SK/Invite/:token/def')
    expect(pathForLog('/account/members')).toBe('/account/members')
  })
})
