// The production compose file (compose.prod.yaml, docs/deploy-dokploy.md): the properties the deployment's
// security rests on, so an edit that loses one fails here.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parse } from 'yaml'

const ROOT = join(import.meta.dirname, '..', '..')
const text = readFileSync(join(ROOT, 'compose.prod.yaml'), 'utf8')

interface Service {
  image?: string
  build?: { context: string; dockerfile?: string; args?: Record<string, string> } | string
  command?: string[]
  user?: string
  read_only?: boolean
  tmpfs?: string[]
  cap_drop?: string[]
  security_opt?: string[]
  env_file?: unknown
  environment?: Record<string, string>
  ports?: unknown
  restart?: string
  healthcheck?: { test?: string[]; disable?: boolean }
  networks?: string[]
  depends_on?: Record<string, { condition: string }>
  deploy?: { resources?: { limits?: { cpus?: string; memory?: string } } }
}
const compose = parse(text, { merge: true }) as { name?: string; services: Record<string, Service>; networks: Record<string, { internal?: boolean; external?: boolean }> }
const { services } = compose

/** What src/server/env.ts reads, plus the server's address. */
const RUNTIME = ['BETTER_AUTH_SECRET', 'DATABASE_URL', 'DATABASE_URL_SYSTEM', 'MAIL_FROM', 'NODE_ENV', 'PUBLIC_ORIGIN', 'SMTP_URL', 'SUPER_ADMIN_EMAILS', 'TRUSTED_PROXIES']

describe('compose.prod.yaml', () => {
  test('the app, the worker and the migration run one image, built for PUBLIC_ORIGIN, named per application', () => {
    const image = services.app?.image
    // Dokploy's project name, never a name two applications on one server would share
    expect(compose.name).toBeUndefined()
    expect(image).toBe('${IMAGE_NAME:?the Dokploy application name}:${IMAGE_TAG:-latest}')
    expect(services.backup?.image).toBe('${IMAGE_NAME:?the Dokploy application name}-backup:${IMAGE_TAG:-latest}')
    expect(services.worker?.image).toBe(image)
    expect(services.migrate?.image).toBe(image)
    expect(services.app?.build).toEqual({ context: '..', dockerfile: 'cmp/Dockerfile', args: { PUBLIC_ORIGIN: '${PUBLIC_ORIGIN:?https origin}' } })
    expect(services.worker?.command).toEqual(['node', 'dist/worker.js'])
  })

  test('the app and the worker get the runtime variables only: never the owner, admin or backup credentials', () => {
    for (const name of Object.keys(services)) expect(services[name]?.env_file, name).toBeUndefined()
    expect(Object.keys(services.app?.environment ?? {}).sort()).toEqual([...RUNTIME, 'HOST', 'PORT'].sort())
    expect(Object.keys(services.worker?.environment ?? {}).sort()).toEqual(RUNTIME)
    expect(services.app?.environment?.NODE_ENV).toBe('production')
  })

  test('the migration runs once before them: db:init with the superuser, then the migrations as the owner', () => {
    expect(services.migrate?.command).toEqual(['sh', '-c', 'node scripts/db-init.ts && node scripts/migrate.ts'])
    expect(services.migrate?.restart).toBe('no')
    expect(Object.keys(services.migrate?.environment ?? {}).sort()).toEqual(['DATABASE_URL', 'DATABASE_URL_ADMIN', 'DATABASE_URL_BACKUP', 'DATABASE_URL_MIGRATE', 'DATABASE_URL_SYSTEM'])
    for (const name of ['app', 'worker']) expect(services[name]?.depends_on?.migrate, name).toEqual({ condition: 'service_completed_successfully' })
  })

  test('every container: read-only root filesystem, no capabilities or privilege gain, resource limits', () => {
    for (const [name, service] of Object.entries(services)) {
      expect(service.read_only, name).toBe(true)
      expect(service.cap_drop, name).toEqual(['ALL'])
      expect(service.security_opt, name).toContain('no-new-privileges:true')
      expect(service.deploy?.resources?.limits?.memory, name).toBeTruthy()
      expect(service.deploy?.resources?.limits?.cpus, name).toBeTruthy()
      expect(service.tmpfs?.some((t) => t.startsWith('/tmp')), name).toBe(true)
    }
    for (const name of ['app', 'worker', 'migrate']) expect(services[name]?.user, name).toBe('node')
  })

  test('health: the app is ready when the database answers; the image checks liveness', () => {
    expect(services.app?.healthcheck?.test?.join(' ')).toContain('/readyz')
    expect(readFileSync(join(ROOT, 'Dockerfile'), 'utf8')).toMatch(/HEALTHCHECK[\s\S]*\/healthz/)
  })

  test('the database is on an internal network, published nowhere; only the app is on the proxy network', () => {
    expect(compose.networks.db?.internal).toBe(true)
    expect(compose.networks['dokploy-network']?.external).toBe(true)
    for (const [name, service] of Object.entries(services)) {
      expect(service.ports, name).toBeUndefined()
      expect(service.networks?.includes('dokploy-network') ?? false, name).toBe(name === 'app')
    }
    expect(services.postgres?.networks).toEqual(['db'])
  })

  test('backups: encrypted to a public key, as the read-only backup role (never the superuser)', () => {
    expect(Object.keys(services.backup?.environment ?? {}).sort()).toEqual(['BACKUP_AGE_RECIPIENT', 'BACKUP_AT', 'BACKUP_DATABASE_URL', 'BACKUP_KEEP_DAYS'])
    expect(services.backup?.environment?.BACKUP_DATABASE_URL).toBe('${DATABASE_URL_BACKUP:?cmp_backup URL}')
    // the superuser's credentials reach Postgres itself and the one-shot db:init, nothing else
    for (const [name, service] of Object.entries(services)) {
      const values = JSON.stringify(service.environment ?? {})
      if (name !== 'postgres') expect(values.includes('POSTGRES_PASSWORD'), name).toBe(false)
      if (name !== 'migrate') expect(values.includes('DATABASE_URL_ADMIN'), name).toBe(false)
    }
    expect(readFileSync(join(ROOT, 'backup', 'backup.sh'), 'utf8')).toMatch(/pg_dump[^\n]*\| age --encrypt --recipient/)
  })

  test('no domain is written here', () => {
    expect(text).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/)
    expect(text).not.toMatch(/Host\(/)
  })
})
