import { useId, useState } from 'react'

import { Field, FormMessage, submitting } from '@/components/auth/fields'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { m } from '@/paraglide/messages.js'

import { assignableRoles, roleName, type RoleName } from './roles'

interface Props {
  accountId: string
  /** The inviting member's role: which roles they may give. */
  role: RoleName
}

const MESSAGES: Readonly<Record<string, () => string>> = {
  ALREADY_MEMBER: m.members_error_already_member,
  ALREADY_INVITED: m.members_error_already_invited,
  OWNER_ONLY: m.members_error_owner_only,
  INVITATION_LIMIT_PENDING: m.members_error_limit_pending,
  INVITATION_LIMIT_ACCOUNT_DAY: m.members_error_limit_account_day,
  INVITATION_LIMIT_USER_DAY: m.members_error_limit_user_day,
}

/** Invites an email address to the account; the invitation's email is sent by the server. */
export default function InviteForm({ accountId, role }: Props) {
  const roleId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = submitting(setBusy, setError, async (form) => {
    const body = { accountId, email: String(form.get('email')), role: String(form.get('role')) }
    const { error } = await authClient.$fetch('/account/invite', { method: 'POST', body })
    if (error) {
      // the server's JSON body (its code) is spread into the error
      const { code } = error as { code?: string }
      return MESSAGES[code ?? '']?.() ?? authErrorMessage({ code, status: error.status })
    }
    // the page lists the new invitation
    window.location.assign(`${window.location.pathname}?done=invite`)
    return null
  })

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <Field label={m.auth_email_label()} name="email" type="email" autoComplete="off" required />
      <div className="grid gap-2">
        <Label htmlFor={roleId}>{m.members_invite_role_label()}</Label>
        <NativeSelect id={roleId} name="role" defaultValue="editor">
          {assignableRoles(role).map((r) => (
            <option key={r} value={r}>
              {roleName(r)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <FormMessage error={error} />
      <Button type="submit" disabled={busy}>
        {m.members_invite_submit()}
      </Button>
    </form>
  )
}
