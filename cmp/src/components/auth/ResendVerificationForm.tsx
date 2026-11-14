import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { m } from '@/paraglide/messages.js'

import { Field, FormMessage, submitting } from './fields'

/** Sends the confirmation link again. The answer is the same whether or not the address has an account. */
export default function ResendVerificationForm() {
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = submitting(setBusy, setError, async (form) => {
    const { error } = await authClient.sendVerificationEmail({ email: String(form.get('email')) })
    if (error) return authErrorMessage(error)
    setSent(true)
    return null
  })

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <Field label={m.auth_email_label()} name="email" type="email" autoComplete="email" required />
      <FormMessage error={error} success={sent ? m.verify_email_resent() : null} />
      <Button type="submit" variant="outline" disabled={busy}>
        {m.verify_email_resend()}
      </Button>
    </form>
  )
}
