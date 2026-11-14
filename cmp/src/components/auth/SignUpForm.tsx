import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { m } from '@/paraglide/messages.js'

import { Field, FormMessage, submitting } from './fields'

interface Props {
  /** Where to go once the account is created: the page that says to check the inbox. */
  sentHref: string
}

/** Name, email and password. The address must be confirmed by the emailed link before signing in. */
export default function SignUpForm({ sentHref }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = submitting(setBusy, setError, async (form) => {
    const { error } = await authClient.signUp.email({
      name: String(form.get('name')),
      email: String(form.get('email')),
      password: String(form.get('password')),
    })
    if (error) return authErrorMessage(error)
    window.location.assign(sentHref)
    return null
  })

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <Field label={m.auth_name_label()} name="name" autoComplete="name" required maxLength={200} />
      <Field label={m.auth_email_label()} name="email" type="email" autoComplete="email" required />
      <Field
        label={m.auth_password_label()}
        hint={m.auth_password_hint()}
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
        maxLength={128}
      />
      <FormMessage error={error} />
      <Button type="submit" disabled={busy}>
        {m.sign_up_submit()}
      </Button>
    </form>
  )
}
