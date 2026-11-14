import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { m } from '@/paraglide/messages.js'

import { Field, FormMessage, submitting } from './fields'

interface Props {
  /** Where to go once signed in (a path on this site, checked by the page). */
  next: string
  /** The second step's page, carrying `next`. */
  twoFactorHref: string
}

/** Email and password (then the second step when 2FA is on), or a passkey. */
export default function SignInForm({ next, twoFactorHref }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = submitting(setBusy, setError, async (form) => {
    const { data, error } = await authClient.signIn.email({ email: String(form.get('email')), password: String(form.get('password')) })
    if (error) return authErrorMessage(error)
    window.location.assign(data && 'twoFactorRedirect' in data && data.twoFactorRedirect ? twoFactorHref : next)
    return null
  })

  async function withPasskey() {
    setBusy(true)
    setError(null)
    try {
      const result = await authClient.signIn.passkey()
      if (result?.error) setError(authErrorMessage(result.error))
      else window.location.assign(next)
    } catch {
      setError(m.auth_error_generic())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6">
      <form className="grid gap-4" onSubmit={onSubmit}>
        <Field label={m.auth_email_label()} name="email" type="email" autoComplete="username webauthn" required />
        <Field label={m.auth_password_label()} name="password" type="password" autoComplete="current-password" required maxLength={128} />
        <FormMessage error={error} />
        <Button type="submit" disabled={busy}>
          {m.sign_in_submit()}
        </Button>
      </form>
      <Button type="button" variant="outline" disabled={busy} onClick={withPasskey}>
        {m.sign_in_passkey()}
      </Button>
    </div>
  )
}
