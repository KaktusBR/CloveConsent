import { m } from '../paraglide/messages.js'
import { Action, Email, Paragraph } from './layout'
import { defineTemplate, formatInstant } from './template'

/** Security notice: a sign-in from a new device. `url` is the security settings page. */
export default defineTemplate({
  fields: { url: 'link', when: 'instant', device: 'text' },
  subject: (_data, locale) => m.email_new_sign_in_subject({}, { locale }),
  body: (data, locale) => (
    <Email locale={locale} title={m.email_new_sign_in_subject({}, { locale })}>
      <Paragraph>{m.email_new_sign_in_intro({ when: formatInstant(data.when, locale), device: data.device }, { locale })}</Paragraph>
      <Paragraph>{m.email_new_sign_in_if_you({}, { locale })}</Paragraph>
      <Paragraph>{m.email_security_not_you({}, { locale })}</Paragraph>
      <Action href={data.url} locale={locale}>
        {m.email_security_action({}, { locale })}
      </Action>
    </Email>
  ),
})
