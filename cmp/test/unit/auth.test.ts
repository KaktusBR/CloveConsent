import { describe, expect, test } from 'vitest'

import en from '../../messages/en.json'
import { sameSitePath } from '../../src/i18n/locale'
import { authErrorMessage } from '../../src/lib/auth-errors'
import { signInPath } from '../../src/server/auth/guard'

describe('next=: only a path on this site', () => {
  test.each([
    '//evil.example',
    'https://evil.example',
    'https://evil.example/account/security',
    '/\\evil.example',
    '\\\\evil.example',
    '/.//evil.example',
    '/a/..//evil.example',
    '/%2f%2fevil.example',
    '/%5cevil.example',
    '/\t/evil.example',
    'javascript:alert(1)',
    'account/security',
    '',
  ])('%j is ignored', (next) => {
    expect(sameSitePath(next)).toBeNull()
  })

  test('null and undefined are ignored', () => {
    expect(sameSitePath(null)).toBeNull()
    expect(sameSitePath(undefined)).toBeNull()
  })

  test.each([
    ['/account/security', '/account/security'],
    ['/sk/account/security', '/sk/account/security'],
    ['/account/security?tab=passkeys', '/account/security?tab=passkeys'],
    ['/a/../account/security', '/account/security'],
  ])('%j is kept as %j', (next, path) => {
    expect(sameSitePath(next)).toBe(path)
  })

  test('the guard sends to the sign-in page of the page language, with the page as next', () => {
    expect(signInPath(new URL('http://localhost:4321/sk/account/security?x=1'))).toBe('/sk/sign-in?next=%2Fsk%2Faccount%2Fsecurity%3Fx%3D1')
    expect(signInPath(new URL('http://localhost:4321/account/security'))).toBe('/sign-in?next=%2Faccount%2Fsecurity')
  })
})

describe('auth errors: translated by code, never the library text', () => {
  test('known codes have their own message', () => {
    expect(authErrorMessage({ code: 'INVALID_EMAIL_OR_PASSWORD', status: 401 })).toBe(en.auth_error_invalid_credentials)
    expect(authErrorMessage({ code: 'PASSWORD_COMPROMISED', status: 400 })).toBe(en.auth_error_password_compromised)
    expect(authErrorMessage({ code: 'INVALID_BACKUP_CODE', status: 401 })).toBe(en.auth_error_invalid_code)
  })

  test('the rate limiter (no code) and unknown codes', () => {
    expect(authErrorMessage({ status: 429 })).toBe(en.auth_error_rate_limited)
    expect(authErrorMessage({ code: 'SOMETHING_NEW', status: 500 })).toBe(en.auth_error_generic)
    expect(authErrorMessage({ code: 'toString', status: 400 })).toBe(en.auth_error_generic)
    expect(authErrorMessage(null)).toBe(en.auth_error_generic)
  })
})
