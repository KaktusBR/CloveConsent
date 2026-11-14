// Transactional email: sendMail queues a `mail.send` job; the worker (src/worker.ts) renders it in the
// reader's language and sends it over SMTP (SMTP_URL, from MAIL_FROM). Subjects and bodies come from the
// catalog (src/emails/*.tsx), as HTML and plain text, with no remote content.
//
// A mail is checked before it is queued and again before it is sent: a known template with exactly its
// values, links only to PUBLIC_ORIGIN, one-line texts. Errors name the field, never its value. Logs carry
// the job, template and language: never the recipient, a link (it may hold a token) or the body.
import { createTransport } from 'nodemailer'
import type { SendMailOptions } from 'nodemailer/lib/mailer'
import { z } from 'zod'
import invitation from '../../emails/invitation'
import newSignIn from '../../emails/new-sign-in'
import { renderHtml, renderText } from '../../emails/render'
import resetPassword from '../../emails/reset-password'
import type { EmailTemplate, FieldKind } from '../../emails/template'
import twoFactorChanged from '../../emails/two-factor-changed'
import verifyEmail from '../../emails/verify-email'
import { locales, type Locale } from '../../i18n/locale'
import type { QueueJob } from '../data/queue'
import type { SystemTx, TenantTx } from '../data/scope'
import { env } from '../env'
import { log as defaultLog, type Logger } from '../log'
import { enqueue } from './queue'

const TEMPLATES = {
  'verify-email': verifyEmail,
  'reset-password': resetPassword,
  invitation,
  'two-factor-changed': twoFactorChanged,
  'new-sign-in': newSignIn,
} as const satisfies Record<string, EmailTemplate>

export type MailTemplate = keyof typeof TEMPLATES
export const MAIL_TEMPLATES = Object.keys(TEMPLATES) as MailTemplate[]

/** Where a mail goes once every retry has failed (created with mail.send by drizzle/0002_job_queue.sql). */
export const MAIL_DEAD_LETTER = 'mail.send.dead'

/** A `mail.send` job: what is stored in the queue until the job is deleted. */
export interface MailJob {
  to: string
  template: MailTemplate
  locale: Locale
  data: Record<string, string>
}

export class MailError extends Error {
  override readonly name = 'MailError'
  constructor(
    /** The field at fault: `to`, `template`, `locale` or `data.<name>`. */
    readonly field: string,
    reason: string,
  ) {
    super(`mail: ${field} ${reason}`)
  }
}

const MAX_TEXT = 200
const MAX_LINK = 2048
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u // control and format characters (bidi overrides), line and paragraph separators
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/

function checkValue(field: string, kind: FieldKind, value: unknown): void {
  if (typeof value !== 'string') throw new MailError(field, 'must be a string')
  if (Array.isArray(kind)) {
    if (!kind.includes(value)) throw new MailError(field, `must be one of ${kind.join(', ')}`)
    return
  }
  if (kind === 'text') {
    if (value.trim() === '' || value.length > MAX_TEXT || CONTROL.test(value)) {
      throw new MailError(field, `must be one line of 1 to ${MAX_TEXT} characters`)
    }
  } else if (kind === 'link') {
    const url = value.length <= MAX_LINK && URL.canParse(value) ? new URL(value) : null
    if (url?.origin !== env.PUBLIC_ORIGIN) throw new MailError(field, 'must be a link on the public origin')
  } else if (!ISO_INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
    throw new MailError(field, 'must be an ISO 8601 time')
  }
}

/** A clean copy of a valid mail; throws MailError otherwise. */
export function checkMail(input: MailJob): MailJob {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new MailError('mail', 'must be an object')
  const { to, template, locale, data } = input
  if (typeof to !== 'string' || !z.email().safeParse(to).success) throw new MailError('to', 'must be one email address')
  if (typeof template !== 'string' || !Object.hasOwn(TEMPLATES, template)) throw new MailError('template', 'is not a known template')
  if (!(locales as readonly unknown[]).includes(locale)) throw new MailError('locale', 'is not a shipped language')
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new MailError('data', 'must be an object')
  const fields: Record<string, FieldKind> = TEMPLATES[template].fields
  for (const key of Object.keys(data)) if (!Object.hasOwn(fields, key)) throw new MailError(`data.${key}`, 'is not a value of this template')
  const clean: Record<string, string> = {}
  for (const [key, kind] of Object.entries(fields)) {
    if (!Object.hasOwn(data, key)) throw new MailError(`data.${key}`, 'is missing')
    checkValue(`data.${key}`, kind, data[key])
    clean[key] = data[key] as string
  }
  return { to, template, locale, data: clean }
}

export interface RenderedMail {
  subject: string
  html: string
  text: string
}

/** The mail's subject, HTML and plain text, in its language. */
export function renderMail(input: MailJob): RenderedMail {
  const { template, locale, data } = checkMail(input)
  // each template is typed by its own fields; checkMail has just matched `data` to them
  const definition: EmailTemplate = TEMPLATES[template]
  const body = definition.body(data, locale)
  return {
    // one line, whatever a value holds (a subject is a header)
    subject: definition.subject(data, locale).replace(/\s+/g, ' ').trim(),
    html: renderHtml(body),
    text: renderText(body),
  }
}

/** Queue a mail; the worker renders and sends it. With `tx`, it is sent only if that transaction commits. */
export async function sendMail(input: MailJob, opts: { tx?: TenantTx | SystemTx } = {}): Promise<void> {
  await enqueue('mail.send', checkMail(input), opts)
}

/** What delivery needs of a nodemailer transport (tests pass an in-memory one). */
export interface MailTransport {
  sendMail(message: SendMailOptions): Promise<unknown>
  close?(): void
}

/** The SMTP transport of SMTP_URL. */
export function createMailTransport(url: string = env.SMTP_URL): MailTransport {
  return createTransport({ url, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000 })
}

/** Render and send one mail. Throws if the transport fails (the queue then retries the job). */
export async function deliverMail(job: MailJob, transport: MailTransport, log: Logger = defaultLog): Promise<void> {
  const mail = renderMail(job)
  await transport.sendMail({
    from: env.MAIL_FROM,
    to: job.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    headers: { 'Auto-Submitted': 'auto-generated' },
  })
  log.info({ template: job.template, locale: job.locale }, 'mail sent')
}

/** Safe parts of a delivery error: no message (an SMTP reply can quote the recipient). */
function errorFields(err: unknown): Record<string, unknown> {
  const e = (err ?? {}) as { name?: unknown; code?: unknown; responseCode?: unknown; command?: unknown }
  return { name: e.name, code: e.code, responseCode: e.responseCode, command: e.command }
}

/** A failed delivery as the queue stores it (the job's output): its safe parts only. */
export class MailDeliveryError extends Error {
  override readonly name = 'MailDeliveryError'
  constructor(readonly details: Record<string, unknown>) {
    super(`mail delivery failed (${typeof details.code === 'string' ? details.code : 'no code'})`)
  }
}

/** A string field of stored job data, which may be anything a role that inserts jobs wrote. */
function stringField(value: unknown, key: string): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : null
}

/**
 * What a mail job keeps once it is done (sent, or failed for good): template and language. Never the
 * recipient or the values, whose links may carry a one-time token; the dead-letter copy takes this too.
 */
function summary(data: unknown): { template: MailTemplate | null; locale: Locale | null } {
  const template = stringField(data, 'template')
  const locale = stringField(data, 'locale')
  return {
    template: template !== null && Object.hasOwn(TEMPLATES, template) ? (template as MailTemplate) : null,
    locale: locale !== null && (locales as readonly string[]).includes(locale) ? (locale as Locale) : null,
  }
}

/** Overwrite the job's data with its summary; a failure is logged, never thrown (the mail may be sent already). */
async function scrub(job: QueueJob, log: Logger): Promise<void> {
  try {
    await job.replaceData(summary(job.data))
  } catch (err) {
    log.warn({ error: (err as Error).message }, 'mail job data not cleared')
  }
}

/**
 * The worker's handler of `mail.send`: deliver, log each failed attempt, and fail with a sanitized error
 * so the queue retries. Once the job is done (sent, invalid, or out of retries) its data is cut down to
 * the summary.
 */
export function mailHandler(transport: MailTransport, log: Logger = defaultLog) {
  return async (job: QueueJob): Promise<void | 'dead-letter'> => {
    const jobLog = log.child({ jobId: job.id })
    const kept = summary(job.data)
    let mail: MailJob
    try {
      mail = checkMail(job.data as MailJob)
    } catch (err) {
      // never valid, so never deliverable: straight to the dead-letter queue
      jobLog.error({ ...kept, field: err instanceof MailError ? err.field : null }, 'mail job invalid')
      await scrub(job, jobLog)
      return 'dead-letter'
    }
    try {
      await deliverMail(mail, transport, jobLog)
    } catch (err) {
      const error = errorFields(err)
      jobLog.warn({ ...kept, attempt: job.retryCount + 1, attempts: job.retryLimit + 1, error }, 'mail delivery failed')
      if (job.retryCount >= job.retryLimit) await scrub(job, jobLog)
      throw new MailDeliveryError(error)
    }
    await scrub(job, jobLog)
  }
}

/** The worker's handler of the dead-letter queue: the mail was never sent, which the log must show. */
export function deadMailHandler(log: Logger = defaultLog) {
  return async (job: QueueJob): Promise<void> => {
    log.error({ jobId: job.id, failedJobId: job.sourceId, ...summary(job.data), attempts: (job.sourceRetryCount ?? 0) + 1 }, 'mail dead-lettered')
    // a job that expired on its last attempt reaches here with its full data
    await scrub(job, log.child({ jobId: job.id }))
  }
}
