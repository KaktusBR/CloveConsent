import { describe, expect, test } from 'vitest'

import en from '../../messages/en.json'
import { sameSitePath } from '../../src/i18n/locale'
import { authErrorMessage } from '../../src/lib/auth-errors'
import { signInPath } from '../../src/server/auth/guard'
import { clientAddress, clientOf, trustedProxies } from '../../src/server/client-address'

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

describe('clientAddress: the address rate limits count, never chosen by the client', () => {
  const proxies = trustedProxies(['10.0.0.0/8', 'fd00::/8'])
  const none = trustedProxies([])

  test('without trusted proxies, the socket peer, whatever X-Forwarded-For says', () => {
    expect(clientAddress('203.0.113.5', '198.51.100.1', none)).toBe('203.0.113.5')
    expect(clientAddress('203.0.113.5', null, none)).toBe('203.0.113.5')
  })

  test('a peer that is not a trusted proxy: its own address, the header is ignored', () => {
    expect(clientAddress('203.0.113.5', '198.51.100.1', proxies)).toBe('203.0.113.5')
  })

  test('from a trusted proxy: the nearest address in X-Forwarded-For that is not a trusted proxy', () => {
    expect(clientAddress('10.0.0.2', '198.51.100.1', proxies)).toBe('198.51.100.1')
    // a client's own value is to the left of what the proxy appended
    expect(clientAddress('10.0.0.2', '6.6.6.6, 198.51.100.1', proxies)).toBe('198.51.100.1')
    expect(clientAddress('10.0.0.2', '198.51.100.1, 10.1.1.1', proxies)).toBe('198.51.100.1')
    expect(clientAddress('fd00::2', '2001:db8::7', proxies)).toBe('2001:db8::')
  })

  test('from a trusted proxy without a usable header: the proxy itself (never a shared bucket)', () => {
    expect(clientAddress('10.0.0.2', null, proxies)).toBe('10.0.0.2')
    expect(clientAddress('10.0.0.2', '10.1.1.1', proxies)).toBe('10.1.1.1')
  })

  test('a garbage hop stops the walk at the last trusted address', () => {
    expect(clientAddress('10.0.0.2', 'not-an-ip', proxies)).toBe('10.0.0.2')
    expect(clientAddress('10.0.0.2', '198.51.100.1, junk, 10.1.1.1', proxies)).toBe('10.1.1.1')
  })

  test('IPv4-mapped IPv6 peers are their IPv4 address', () => {
    expect(clientAddress('::ffff:203.0.113.5', null, none)).toBe('203.0.113.5')
    expect(clientAddress('::ffff:10.0.0.2', '198.51.100.1', proxies)).toBe('198.51.100.1')
  })

  test('an IPv6 client is its /64 (one subscriber line): every address in it is the same client', () => {
    expect(clientAddress('2001:db8:1:2:aaaa:bbbb:cccc:dddd', null, none)).toBe('2001:db8:1:2::')
    expect(clientAddress('2001:db8:1:2::1', null, none)).toBe('2001:db8:1:2::')
    expect(clientAddress('2001:db8:1:3::1', null, none)).toBe('2001:db8:1:3::')
    expect(clientAddress('10.0.0.2', '2001:db8:9:8:1::5', proxies)).toBe('2001:db8:9:8::')
    expect(clientAddress('::1', null, none)).toBe('::')
  })

  test('no usable peer: no address (the request is refused, not bucketed with others)', () => {
    expect(clientAddress(undefined, '198.51.100.1', proxies)).toBeNull()
    expect(clientAddress('', null, none)).toBeNull()
    expect(clientAddress('nonsense', null, none)).toBeNull()
  })
})

describe('auth errors: translated by code, never the library text', () => {
  test('known codes have their own message', () => {
    expect(authErrorMessage({ code: 'INVALID_EMAIL_OR_PASSWORD', status: 401 })).toBe(en.auth_error_invalid_credentials)
    expect(authErrorMessage({ code: 'PASSWORD_COMPROMISED', status: 400 })).toBe(en.auth_error_password_compromised)
    expect(authErrorMessage({ code: 'INVALID_BACKUP_CODE', status: 401 })).toBe(en.auth_error_invalid_code)
  })

  test('a 429 with a code of its own keeps its message: the second-step lockout', () => {
    expect(authErrorMessage({ code: 'ACCOUNT_TEMPORARILY_LOCKED', status: 429 })).toBe(en.auth_error_locked)
  })

  test('the rate limiter (no code) and unknown codes', () => {
    expect(authErrorMessage({ status: 429 })).toBe(en.auth_error_rate_limited)
    expect(authErrorMessage({ code: 'SOMETHING_NEW', status: 500 })).toBe(en.auth_error_generic)
    expect(authErrorMessage({ code: 'toString', status: 400 })).toBe(en.auth_error_generic)
    expect(authErrorMessage(null)).toBe(en.auth_error_generic)
  })
})

describe('clientOf', () => {
  test('IPv6 with an embedded IPv4 tail is grouped by its /64 too', () => {
    expect(clientOf('64:ff9b:1:2::192.0.2.1')).toBe('64:ff9b:1:2::')
    expect(clientOf('2001:db8:aaaa:bbbb:cccc:dddd:eeee:ffff')).toBe('2001:db8:aaaa:bbbb::')
    expect(clientOf('203.0.113.5')).toBe('203.0.113.5')
  })
})
