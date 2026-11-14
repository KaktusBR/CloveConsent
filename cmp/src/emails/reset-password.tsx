import { m } from '../paraglide/messages.js'
import { Action, Email, Paragraph } from './layout'
import { defineTemplate } from './template'

/** The link to choose a new password. */
export default defineTemplate({
  fields: { url: 'link' },
  subject: (_data, locale) => m.email_reset_subject({}, { locale }),
  body: (data, locale) => (
    <Email locale={locale} title={m.email_reset_subject({}, { locale })}>
      <Paragraph>{m.email_reset_intro({}, { locale })}</Paragraph>
      <Action href={data.url} locale={locale}>
        {m.email_reset_action({}, { locale })}
      </Action>
      <Paragraph>{m.email_reset_ignore({}, { locale })}</Paragraph>
    </Email>
  ),
})
