import { m } from '../paraglide/messages.js'
import { Action, Email, Paragraph } from './layout'
import { defineTemplate } from './template'

/** Sent at sign-up: the link that confirms the address. */
export default defineTemplate({
  fields: { url: 'link' },
  subject: (_data, locale) => m.email_verify_subject({}, { locale }),
  body: (data, locale) => (
    <Email locale={locale} title={m.email_verify_subject({}, { locale })}>
      <Paragraph>{m.email_verify_intro({}, { locale })}</Paragraph>
      <Action href={data.url} locale={locale}>
        {m.email_verify_action({}, { locale })}
      </Action>
      <Paragraph>{m.email_verify_ignore({}, { locale })}</Paragraph>
    </Email>
  ),
})
