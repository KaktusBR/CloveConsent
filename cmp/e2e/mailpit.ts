import type { APIRequestContext } from '@playwright/test'

const MAILPIT = process.env.MAILPIT_URL || 'http://localhost:8025'

/** The text of the newest mail to `to` whose subject is `subject`, waiting for the worker to send it. */
export async function mail(request: APIRequestContext, to: string, subject: string): Promise<string> {
  const deadline = Date.now() + 30_000
  for (;;) {
    const found = await request.get(`${MAILPIT}/api/v1/search`, { params: { query: `to:"${to}" subject:"${subject}"` } })
    const { messages } = (await found.json()) as { messages: { ID: string }[] }
    const first = messages[0]
    if (first) return ((await (await request.get(`${MAILPIT}/api/v1/message/${first.ID}`)).json()) as { Text: string }).Text
    if (Date.now() > deadline) throw new Error(`no mail "${subject}" to ${to}`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

/** The one link to `origin` in a mail's text. */
export function linkIn(text: string, origin: string): string {
  const link = text.match(new RegExp(`${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\S+`))?.[0]
  if (!link) throw new Error('no link in the mail')
  return link
}

/** Deletes every mail to `to` (for a fixed address that an earlier run also wrote to). */
export async function deleteMailTo(to: string): Promise<void> {
  const response = await fetch(`${MAILPIT}/api/v1/search?${new URLSearchParams({ query: `to:"${to}"` })}`, { method: 'DELETE' })
  if (!response.ok) throw new Error(`Mailpit did not delete the mail to ${to}`)
}
