import { z } from 'zod'

import { isOrigin, parseUrl } from './origin'

const urlOf = (...protocols: string[]) =>
  z.string().refine((v) => {
    const url = parseUrl(v)
    return url !== null && protocols.includes(url.protocol) && url.hostname !== ''
  })

/** `address` or `Name <address>`. */
function isMailbox(value: string): boolean {
  const m = /^(?:[^<>]*<\s*([^<>\s]+)\s*>|([^<>\s]+))$/.exec(value.trim())
  const address = m?.[1] ?? m?.[2]
  return address !== undefined && z.email().safeParse(address).success
}

// The owner (DATABASE_URL_MIGRATE) and admin (DATABASE_URL_ADMIN) credentials are deliberately not
// here: the app and worker never hold them. scripts/migrate.ts and scripts/db-init.ts read their own.
const schema = z.object({
  DATABASE_URL: urlOf('postgres:', 'postgresql:'),
  DATABASE_URL_SYSTEM: urlOf('postgres:', 'postgresql:'),
  BETTER_AUTH_SECRET: z.string().refine((v) => Buffer.byteLength(v, 'utf8') >= 32),
  PUBLIC_ORIGIN: z.string().refine(isOrigin).transform((v) => new URL(v).origin),
  SMTP_URL: urlOf('smtp:', 'smtps:'),
  MAIL_FROM: z.string().refine(isMailbox),
  SUPER_ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
    .pipe(z.array(z.email())),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export type Env = Readonly<z.infer<typeof schema>>

/** What each variable must be. Error messages use only these texts, never a value from the environment. */
const REQUIREMENT: Record<keyof z.infer<typeof schema>, string> = {
  DATABASE_URL: 'a postgres:// URL (the app role)',
  DATABASE_URL_SYSTEM: 'a postgres:// URL (the system role)',
  BETTER_AUTH_SECRET: 'a secret of at least 32 bytes',
  PUBLIC_ORIGIN: 'a bare https origin (http only for localhost, and never in production)',
  SMTP_URL: 'an smtp:// or smtps:// URL',
  MAIL_FROM: 'an email address, optionally as "Name <address>"',
  SUPER_ADMIN_EMAILS: 'a comma-separated list of email addresses',
  NODE_ENV: 'one of development, test, production',
}

export class EnvError extends Error {
  override readonly name = 'EnvError'
  /** The names of the invalid variables. */
  readonly variables: string[]

  constructor(variables: string[]) {
    const lines = variables.map((v) => `  ${v}: must be ${REQUIREMENT[v as keyof typeof REQUIREMENT]}`)
    super(`Invalid environment (values not shown):\n${lines.join('\n')}`)
    this.variables = variables
  }
}

/** Validate an environment. Throws EnvError naming every invalid variable; values never appear in the error. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const input: Record<string, string | undefined> = {}
  for (const key of Object.keys(REQUIREMENT)) input[key] = source[key] === '' ? undefined : source[key]
  const result = schema.safeParse(input)
  const names = new Set(result.success ? [] : result.error.issues.map((i) => String(i.path[0])))
  // plain http is for local development and tests only
  if (input.NODE_ENV === 'production' && parseUrl(input.PUBLIC_ORIGIN ?? '')?.protocol === 'http:') names.add('PUBLIC_ORIGIN')
  if (!result.success || names.size > 0) throw new EnvError([...names].sort())
  return Object.freeze(result.data)
}

/** The process environment, validated once when this module is first loaded. */
export const env: Env = parseEnv(process.env)
