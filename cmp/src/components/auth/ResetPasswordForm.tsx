import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { m } from '@/paraglide/messages.js'

import { Field, FormMessage, submitting } from './fields'

interface Props {
  /** The token of the emailed link. */
  token: string
  signInHref: string
}

/** A new password from the emailed link. Every session of the user ends (revokeSessionsOnPasswordReset). */
export default function ResetPasswordForm({ token, signInHref }: Props) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = submitting(setBusy, setError, async (form) => {
    const newPassword = String(form.get('password'))
    if (newPassword !== String(form.get('confirm'))) return m.auth_error_passwords_differ()
    const { error } = await authClient.resetPassword({ newPassword, token })
    if (error) return authErrorMessage(error)
    setDone(true)
    return null
  })

  if (done) {
    return (
      <div role="status" className="grid gap-4">
        <p>{m.reset_password_done()}</p>
        <a href={signInHref} className="font-medium underline underline-offset-4">
          {m.sign_in_heading()}
        </a>
      </div>
    )
  }

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <Field
        label={m.reset_password_new_label()}
        hint={m.auth_password_hint()}
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
        maxLength={128}
      />
      <Field label={m.reset_password_confirm_label()} name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
      <FormMessage error={error} />
      <Button type="submit" disabled={busy}>
        {m.reset_password_submit()}
      </Button>
    </form>
  )
}
