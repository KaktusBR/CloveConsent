import { createTransport } from 'nodemailer'
import { describe, expect, test } from 'vitest'
import { checkMail, deliverMail, MAIL_TEMPLATES, MailError, renderMail, type MailJob, type MailTransport } from '../../src/server/jobs/mail'
import { captureLog } from './capture-log'

// PUBLIC_ORIGIN and MAIL_FROM of vitest.config.ts
const ORIGIN = 'http://localhost:4321'
const FROM = 'noreply@localhost.test'
const TOKEN = 'tok_0123456789abcdef'

/** Valid data for every template. */
const DATA: Record<MailJob['template'], Record<string, string>> = {
  'verify-email': { url: `${ORIGIN}/verify-email?token=${TOKEN}` },
  'reset-password': { url: `${ORIGIN}/reset-password?token=${TOKEN}` },
  invitation: { url: `${ORIGIN}/invitation/${TOKEN}`, inviter: 'Ana Nováková', account: 'Acme' },
  'two-factor-changed': { url: `${ORIGIN}/settings/security`, state: 'enabled' },
  'new-sign-in': { url: `${ORIGIN}/settings/security`, when: '2026-11-13T09:30:00.000Z', device: 'Firefox on Linux' },
}

const job = (template: MailJob['template'], locale: MailJob['locale'], data = DATA[template]): MailJob => ({ to: 'ana@example.test', template, locale, data })

/** nodemailer's in-memory JSON transport: the message as it would go on the wire, parsed back. */
function memoryTransport() {
  const transport = createTransport({ jsonTransport: true })
  const sent: { subject: string; html: string; text: string; from: { address: string }; to: { address: string }[]; headers: Record<string, string> }[] = []
  const wrapped: MailTransport = {
    async sendMail(message) {
      const info = await transport.sendMail(message)
      sent.push(JSON.parse(String(info.message)) as (typeof sent)[number])
      return info
    },
  }
  return { transport: wrapped, sent }
}

describe('delivery', () => {
  test('a mail job reaches the transport with the subject in the requested language, as HTML and plain text', async () => {
    const { transport, sent } = memoryTransport()
    await deliverMail(job('verify-email', 'sk'), transport)
    await deliverMail(job('verify-email', 'en'), transport)
    expect(sent.map((m) => m.subject)).toEqual(['Potvrďte svoju e-mailovú adresu', 'Confirm your email address'])
    const [sk] = sent
    expect(sk?.to.map((t) => t.address)).toEqual(['ana@example.test'])
    expect(sk?.from.address).toBe(FROM)
    expect(sk?.html).toContain('lang="sk"')
    expect(sk?.html).toContain(`href="${DATA['verify-email'].url}"`)
    expect(sk?.text).toContain(DATA['verify-email'].url)
    expect(sk?.headers).toMatchObject({ 'Auto-Submitted': 'auto-generated' })
  })

  test('a failing transport makes delivery fail (so the queue retries it)', async () => {
    const failing: MailTransport = { sendMail: () => Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })) }
    await expect(deliverMail(job('reset-password', 'en'), failing)).rejects.toThrow('ECONNREFUSED')
  })
})

describe('rendering', () => {
  test.each(MAIL_TEMPLATES)('%s renders in every language, as HTML and text, with no remote content', (template) => {
    const en = renderMail(job(template, 'en'))
    const sk = renderMail(job(template, 'sk'))
    for (const mail of [en, sk]) {
      expect(mail.subject.trim()).not.toBe('')
      expect(mail.html.startsWith('<!DOCTYPE html>')).toBe(true)
      expect(mail.text.trim()).not.toBe('')
      expect(mail.text).not.toMatch(/<[a-z]/i) // plain text, no markup
      expect(mail.text).toContain(DATA[template].url)
      // no images, stylesheets, fonts or scripts from anywhere: the only URLs are the links
      expect(mail.html).not.toMatch(/<(img|link|script|iframe|object|embed)\b/i)
      expect(mail.html).not.toMatch(/\burl\(|\bsrc=|@import/i)
    }
    expect(sk.subject).not.toBe(en.subject)
    expect(sk.text).not.toBe(en.text)
  })

  test('a value with markup is escaped in the HTML, and left as text in the plain-text part', () => {
    const data = { ...DATA.invitation, inviter: '<script>alert(1)</script>', account: '"><img src=x onerror=alert(1)>' }
    const mail = renderMail(job('invitation', 'en', data))
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).not.toContain('<img')
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(mail.text).toContain('<script>alert(1)</script> invited you')
  })

  test('the time of a new sign-in is written for the reader’s language, in UTC', () => {
    expect(renderMail(job('new-sign-in', 'en')).text).toMatch(/November 13, 2026.*9:30.*UTC/)
    expect(renderMail(job('new-sign-in', 'sk')).text).toMatch(/13\. novembra 2026.*9:30.*UTC/)
  })

  test('two-factor-changed says whether it was turned on or off', () => {
    const on = renderMail(job('two-factor-changed', 'en', { ...DATA['two-factor-changed'], state: 'enabled' }))
    const off = renderMail(job('two-factor-changed', 'en', { ...DATA['two-factor-changed'], state: 'disabled' }))
    expect(on.subject).toMatch(/turned on/)
    expect(off.subject).toMatch(/turned off/)
  })
})

describe('checkMail', () => {
  test.each([
    ['a recipient that is not an email address', { to: 'not-an-address' }, 'to'],
    ['a recipient with a second address', { to: 'ana@example.test, eve@example.test' }, 'to'],
    ['an unknown template', { template: 'welcome' }, 'template'],
    ['a language that is not shipped', { locale: 'de' }, 'locale'],
    ['a missing value', { data: {} }, 'data.url'],
    ['an unexpected value', { data: { ...DATA['verify-email'], extra: 'x' } }, 'data.extra'],
    ['a link to another origin', { data: { url: `https://evil.example/verify-email?token=${TOKEN}` } }, 'data.url'],
    ['a javascript: link', { data: { url: 'javascript:alert(1)' } }, 'data.url'],
    ['a link that only starts like the origin', { data: { url: `${ORIGIN}.evil.example/x` } }, 'data.url'],
  ])('refuses %s, naming the field but never the value', (_name, change, field) => {
    const input = { ...job('verify-email', 'en'), ...change } as MailJob
    let error: unknown
    try {
      checkMail(input)
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(MailError)
    expect((error as MailError).field).toBe(field)
    expect((error as Error).message).not.toContain(TOKEN)
    expect((error as Error).message).not.toContain('evil')
  })

  test('refuses a text value with a line break (it could break a header) or one that is too long', () => {
    expect(() => checkMail(job('invitation', 'en', { ...DATA.invitation, inviter: 'Ana\r\nBcc: eve@example.test' }))).toThrow(MailError)
    expect(() => checkMail(job('invitation', 'en', { ...DATA.invitation, account: 'x'.repeat(201) }))).toThrow(MailError)
  })

  test('refuses an unknown state or a time that is not one', () => {
    expect(() => checkMail(job('two-factor-changed', 'en', { ...DATA['two-factor-changed'], state: 'maybe' }))).toThrow(MailError)
    expect(() => checkMail(job('new-sign-in', 'en', { ...DATA['new-sign-in'], when: 'yesterday' }))).toThrow(MailError)
  })

  test('accepts every template with its values', () => {
    for (const template of MAIL_TEMPLATES) expect(() => checkMail(job(template, 'sk'))).not.toThrow()
  })
})

describe('logging', () => {
  test('a delivery is logged without the recipient, the links or the body', async () => {
    const { log, lines } = captureLog()
    const { transport } = memoryTransport()
    await deliverMail(job('reset-password', 'sk'), transport, log)
    const all = JSON.stringify(lines)
    expect(lines.length).toBeGreaterThan(0)
    expect(all).not.toContain(TOKEN)
    expect(all).not.toContain('ana@example.test')
    expect(all).not.toContain('Obnovenie hesla')
  })
})
