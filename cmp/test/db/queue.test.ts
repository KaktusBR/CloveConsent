// The job queue against the real database (and Mailpit, from compose.yaml locally and CI's service
// container): enqueue inside the caller's transaction, the worker delivering mail, retries and the
// dead-letter queue, and the privileges of the queue schema.
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { closeDatabases } from '../../src/server/data/client'
import { closeQueue, startQueueWorker } from '../../src/server/data/queue'
import { asSystem, withAccount, type AccountScope } from '../../src/server/data/scope'
import type { MailJob, MailTransport } from '../../src/server/jobs/mail'
import { sendMail } from '../../src/server/jobs/mail'
import { enqueue } from '../../src/server/jobs/queue'
import { startWorker } from '../../src/worker'
import { captureLog } from '../unit/capture-log'
import { asRole, errorCode, newId } from './raw'

const MAILPIT = process.env.MAILPIT_URL || 'http://localhost:8025'
const ORIGIN = 'http://localhost:4321' // PUBLIC_ORIGIN of vitest.db.config.ts
const scope: AccountScope = { accountId: newId(), userId: newId(), role: 'owner' }

const address = (label: string) => `${label}-${newId()}@example.test`
const verify = (to: string, locale: MailJob['locale'] = 'en'): MailJob => ({
  to,
  template: 'verify-email',
  locale,
  data: { url: `${ORIGIN}/verify-email?token=tok_${newId()}` },
})

/** The jobs addressed to `to`, in any queue, read as the owner. */
async function jobsTo(to: string) {
  return asRole('migrate', async (c) =>
    (await c.query<{ id: string; name: string; state: string; retry_count: number }>(
      `select id, name, state, retry_count from pgboss.job where data->>'to' = $1 order by created_on`,
      [to],
    )).rows,
  )
}

async function until<T>(what: string, probe: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 200))
  }
}

afterAll(async () => {
  await closeQueue()
  await closeDatabases()
})

describe('enqueue', () => {
  test("a job enqueued in the caller's transaction is not created when that transaction rolls back", async () => {
    const to = address('rollback')
    await expect(
      withAccount(scope, async (tx) => {
        await sendMail(verify(to), { tx })
        throw new Error('the caller failed after enqueueing')
      }),
    ).rejects.toThrow('the caller failed')
    expect(await jobsTo(to)).toEqual([])
  })

  test("a job enqueued in the caller's transaction exists once it commits (tenant and system transactions)", async () => {
    const tenant = address('tenant')
    const system = address('system')
    await withAccount(scope, (tx) => sendMail(verify(tenant), { tx }))
    await asSystem('test: enqueue in a system transaction', (tx) => sendMail(verify(system), { tx }))
    expect(await jobsTo(tenant)).toEqual([expect.objectContaining({ name: 'mail.send', state: 'created' })])
    expect(await jobsTo(system)).toEqual([expect.objectContaining({ name: 'mail.send', state: 'created' })])
  })

  test('without a transaction, enqueue commits on its own and returns the job id', async () => {
    const to = address('alone')
    const id = await enqueue('mail.send', verify(to), { startAfter: new Date(Date.now() + 3_600_000) })
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(await jobsTo(to)).toEqual([expect.objectContaining({ state: 'created' })])
  })

  test('an invalid mail is refused before anything is enqueued', async () => {
    const to = address('invalid')
    await expect(sendMail({ ...verify(to), data: { url: 'https://evil.example/x' } })).rejects.toThrow(/data\.url/)
    expect(await jobsTo(to)).toEqual([])
  })
})

describe('the worker', () => {
  test('delivers a mail job over SMTP (Mailpit), in the requested language, with values escaped in the HTML', async () => {
    const to = address('mailpit')
    const worker = await startWorker({ log: captureLog().log, pollingIntervalSeconds: 0.5 })
    try {
      await sendMail({ to, template: 'invitation', locale: 'sk', data: { url: `${ORIGIN}/invitation/${newId()}`, inviter: '<script>alert(1)</script>', account: 'Acme' } })
      const id = await until('the message in Mailpit', async () => {
        const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
        const body = (await res.json()) as { messages: { ID: string }[] }
        return body.messages[0]?.ID
      })
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Subject: string; HTML: string; Text: string }
      expect(message.Subject).toBe('<script>alert(1)</script> vás pozýva do účtu Acme v CloveConsent')
      expect(message.HTML).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
      expect(message.HTML).not.toContain('<script>')
      expect(message.Text).toContain('<script>alert(1)</script> vás pozýva')
      await until('the job to complete', async () => ((await jobsTo(to))[0]?.state === 'completed' ? true : undefined))
    } finally {
      await worker.stop()
    }
  })

  test('a failing SMTP is retried, then the job is dead-lettered and logged, without the link or the recipient', async () => {
    // the real queue retries 5 times with backoff from 30 s; here without delay, the same count
    await asRole('migrate', (c) => c.query(`update pgboss.queue set retry_delay = 0, retry_backoff = false where name = 'mail.send'`))
    const { log, lines } = captureLog()
    const to = address('dead')
    const mail = verify(to)
    let attempts = 0
    const failing: MailTransport = {
      sendMail: (message) => {
        if (message.to === to) attempts++
        return Promise.reject(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' }))
      },
    }
    const worker = await startWorker({ transport: failing, log, pollingIntervalSeconds: 0.5 })
    try {
      await sendMail(mail)
      const id = (await jobsTo(to))[0]?.id
      const dead = await until('the dead-letter log line', async () => lines.find((l) => l.msg === 'mail dead-lettered' && l.failedJobId === id), 40_000)
      expect(dead).toMatchObject({ level: 'error', template: 'verify-email', attempts: 6 })
      expect(attempts).toBe(6)
      const jobs = await jobsTo(to)
      expect(jobs).toEqual([
        expect.objectContaining({ name: 'mail.send', state: 'failed', retry_count: 5 }),
        expect.objectContaining({ name: 'mail.send.dead' }),
      ])
      expect(lines.filter((l) => l.msg === 'mail delivery failed' && l.jobId === id)).toHaveLength(6)
      const all = JSON.stringify(lines)
      expect(all).not.toContain(mail.data.url)
      expect(all).not.toContain(to)
    } finally {
      await worker.stop()
      await asRole('migrate', (c) => c.query(`update pgboss.queue set retry_delay = 30, retry_backoff = true where name = 'mail.send'`))
    }
  })

  test('stop() lets the job in hand finish before it resolves', async () => {
    let inHand: () => void = () => {}
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (inHand = resolve))
    const slow: MailTransport = {
      sendMail: () => {
        inHand()
        return new Promise((done) => (release = () => done({})))
      },
    }
    const worker = await startWorker({ transport: slow, log: captureLog().log, pollingIntervalSeconds: 0.5 })
    const to = address('graceful')
    await sendMail(verify(to))
    await held
    let stopped = false
    const stopping = worker.stop().then(() => (stopped = true))
    await new Promise((r) => setTimeout(r, 500))
    expect(stopped).toBe(false)
    release()
    await stopping
    expect((await jobsTo(to))[0]?.state).toBe('completed')
  })

  test("the worker's maintenance pass runs on its role without errors", async () => {
    const { log, lines } = captureLog()
    const queue = await startQueueWorker({ log, supervise: false })
    try {
      await queue.supervise()
    } finally {
      await queue.stop()
    }
    expect(lines.filter((l) => l.level === 'error' || l.level === 'warn')).toEqual([])
  })
})

describe('the queue schema', () => {
  beforeAll(async () => {
    await enqueue('mail.send', verify(address('privileges')), { startAfter: new Date(Date.now() + 3_600_000) })
  })

  test('belongs to the owner: every object in it, and only the owner may create objects there', async () => {
    const { owners, create } = await asRole('migrate', async (c) => ({
      owners: (await c.query<{ owner: string }>(
        `select distinct pg_get_userbyid(c.relowner) as owner from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'pgboss'
         union select pg_get_userbyid(nspowner) from pg_namespace where nspname = 'pgboss'`,
      )).rows.map((r) => r.owner),
      create: (await c.query<{ role: string; can: boolean }>(
        `select r as role, has_schema_privilege(r, 'pgboss', 'CREATE') as can from unnest(array['cmp_app', 'cmp_system']) r`,
      )).rows,
    }))
    expect(owners).toEqual(['cmp_owner'])
    expect(create).toEqual([{ role: 'cmp_app', can: false }, { role: 'cmp_system', can: false }])
  })

  test('the app role may only read the queue settings and insert jobs: never read, change or delete one', async () => {
    const grants = await asRole('migrate', async (c) =>
      (await c.query<{ grant: string }>(
        `select table_name || ':' || privilege_type as grant from information_schema.role_table_grants
         where grantee = 'cmp_app' and table_schema = 'pgboss' order by 1`,
      )).rows.map((r) => r.grant),
    )
    expect(grants).toEqual(['job_common:INSERT', 'queue:SELECT', 'version:SELECT'])
    for (const statement of [
      'select data from pgboss.job',
      'select data from pgboss.job_common',
      `update pgboss.job_common set state = 'cancelled'`,
      'delete from pgboss.job_common',
      'create table pgboss.sneaky (id int)',
    ]) {
      expect(await asRole('app', (c) => errorCode(c.query(statement))), statement).toBe('42501')
    }
  })

  test('the worker role changes jobs but cannot change the schema', async () => {
    expect(await asRole('system', (c) => errorCode(c.query(`select data from pgboss.job limit 1`)))).toBeNull()
    for (const statement of ['create table pgboss.sneaky (id int)', 'drop table pgboss.job_common', 'truncate pgboss.job_common', 'alter table pgboss.queue add column x int']) {
      expect(await asRole('system', (c) => errorCode(c.query(statement))), statement).toBe('42501')
    }
  })

  test('mail is retried 5 times with backoff, then dead-lettered; mail jobs are deleted after a day', async () => {
    const queues = await asRole('migrate', async (c) =>
      (await c.query(`select name, retry_limit, retry_delay, retry_backoff, retry_delay_max, dead_letter, deletion_seconds, retention_seconds from pgboss.queue order by name`)).rows,
    )
    expect(queues).toEqual([
      { name: 'mail.send', retry_limit: 5, retry_delay: 30, retry_backoff: true, retry_delay_max: 3600, dead_letter: 'mail.send.dead', deletion_seconds: 86_400, retention_seconds: 86_400 },
      { name: 'mail.send.dead', retry_limit: 0, retry_delay: 0, retry_backoff: false, retry_delay_max: null, dead_letter: null, deletion_seconds: 604_800, retention_seconds: 604_800 },
    ])
  })
})
