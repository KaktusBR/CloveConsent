import { useState } from 'react'

import { FormMessage } from '@/components/auth/fields'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { m } from '@/paraglide/messages.js'

interface Props {
  /** The token of the invitation link. */
  token: string
  /** Where to go once accepted: the account's page. */
  accountHref: string
}

/** Why an invitation could not be accepted, by the server's code. */
const REASONS: Readonly<Record<string, () => string>> = {
  INVITATION_NOT_FOUND: m.invite_state_not_found,
  INVITATION_WRONG_EMAIL: m.invite_state_wrong_email,
  INVITATION_EXPIRED: m.invite_state_expired,
  INVITATION_USED: m.invite_state_used,
  INVITATION_CANCELED: m.invite_state_canceled,
  ALREADY_MEMBER: m.invite_state_already_member,
}

/** Accepts the invitation for the signed-in person, then opens the account. */
export default function AcceptInvitation({ token, accountHref }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function accept() {
    setBusy(true)
    setError(null)
    try {
      const { error } = await authClient.$fetch('/account/accept-invitation', { method: 'POST', body: { token } })
      if (!error) {
        window.location.assign(accountHref)
        return
      }
      // the server's JSON body (its code) is spread into the error
      const { code } = error as { code?: string }
      setError(REASONS[code ?? '']?.() ?? authErrorMessage({ code, status: error.status }))
    } catch {
      setError(m.auth_error_generic())
    }
    setBusy(false)
  }

  return (
    <div className="grid gap-4">
      <FormMessage error={error} />
      <Button type="button" disabled={busy} onClick={accept}>
        {m.invite_accept()}
      </Button>
    </div>
  )
}
