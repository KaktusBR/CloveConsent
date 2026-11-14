import { m } from '../paraglide/messages.js'
import { Action, Email, Paragraph } from './layout'
import { defineTemplate } from './template'

/** Security notice: two-factor authentication was turned on or off. `url` is the security settings page. */
export default defineTemplate({
  fields: { url: 'link', state: ['enabled', 'disabled'] },
  subject: (data, locale) =>
    data.state === 'enabled' ? m.email_two_factor_enabled_subject({}, { locale }) : m.email_two_factor_disabled_subject({}, { locale }),
  body: (data, locale) => {
    const enabled = data.state === 'enabled'
    return (
      <Email locale={locale} title={enabled ? m.email_two_factor_enabled_subject({}, { locale }) : m.email_two_factor_disabled_subject({}, { locale })}>
        <Paragraph>{enabled ? m.email_two_factor_enabled_intro({}, { locale }) : m.email_two_factor_disabled_intro({}, { locale })}</Paragraph>
        <Paragraph>{m.email_security_not_you({}, { locale })}</Paragraph>
        <Action href={data.url} locale={locale}>
          {m.email_security_action({}, { locale })}
        </Action>
      </Email>
    )
  },
})
