import { m } from '../paraglide/messages.js'
import { Action, Email, Paragraph } from './layout'
import { defineTemplate } from './template'

/** An invitation to join an account: who invited, to which account, and the link to accept. */
export default defineTemplate({
  fields: { url: 'link', inviter: 'text', account: 'text' },
  subject: (data, locale) => m.email_invitation_subject({ inviter: data.inviter, account: data.account }, { locale }),
  body: (data, locale) => (
    <Email locale={locale} title={m.email_invitation_subject({ inviter: data.inviter, account: data.account }, { locale })}>
      <Paragraph>{m.email_invitation_intro({ inviter: data.inviter, account: data.account }, { locale })}</Paragraph>
      <Action href={data.url} locale={locale}>
        {m.email_invitation_action({}, { locale })}
      </Action>
      <Paragraph>{m.email_invitation_ignore({}, { locale })}</Paragraph>
    </Email>
  ),
})
