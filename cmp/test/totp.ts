// A TOTP code (RFC 6238: SHA-1, 6 digits, 30 s) from an otpauth secret in base32, as an authenticator
// app computes it. Shared by test/db and e2e.
import { createHmac } from 'node:crypto'

function base32(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of secret.replace(/=+$/, '').toUpperCase()) {
    const v = alphabet.indexOf(c)
    if (v < 0) throw new Error('not base32')
    bits += v.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

/** The code for `secret` at `time` (default now), `offset` periods away. */
export function totp(secret: string, offset = 0, time = Date.now()): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30_000) + offset))
  const hmac = createHmac('sha1', base32(secret)).update(counter).digest()
  const at = (hmac[hmac.length - 1] ?? 0) & 0x0f
  const value = (hmac.readUInt32BE(at) & 0x7fffffff) % 1_000_000
  return String(value).padStart(6, '0')
}

/** The base32 secret of an otpauth:// URI. */
export const secretOf = (uri: string): string => new URL(uri).searchParams.get('secret') ?? ''
