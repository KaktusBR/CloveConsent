import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { m } from '@/paraglide/messages.js'

import { Field, FormMessage, submitting } from './fields'

/** Asks for a password-reset link. The answer is the same whether or not the address has an account. */
export default function ForgotPasswordForm() {
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = submitting(setBusy, setError, async (form) => {
    // the emailed link is built by the server (src/server/auth/auth.ts), not from redirectTo
    const { error } = await authClient.requestPasswordReset({ email: String(form.get('email')) })
    if (error) return authErrorMessage(error)
    setSent(true)
    return null
  })

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <Field label={m.auth_email_label()} name="email" type="email" autoComplete="email" required />
      <FormMessage error={error} success={sent ? m.forgot_password_sent() : null} />
      <Button type="submit" disabled={busy}>
        {m.forgot_password_submit()}
      </Button>
    </form>
  )
}
