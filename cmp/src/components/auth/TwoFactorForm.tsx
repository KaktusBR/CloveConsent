import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { m } from '@/paraglide/messages.js'

import { Field, FormMessage, submitting } from './fields'

interface Props {
  /** Where to go once signed in (a path on this site, checked by the page). */
  next: string
}

/** The second sign-in step: a code from the authenticator app, or one of the backup codes (each works once). */
export default function TwoFactorForm({ next }: Props) {
  const [backup, setBackup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = submitting(setBusy, setError, async (form) => {
    const code = String(form.get('code')).replace(/\s+/g, '')
    const { error } = backup ? await authClient.twoFactor.verifyBackupCode({ code }) : await authClient.twoFactor.verifyTotp({ code })
    if (error) return authErrorMessage(error)
    window.location.assign(next)
    return null
  })

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      {backup ? (
        <Field key="backup" label={m.two_factor_backup_label()} name="code" autoComplete="off" spellCheck={false} required maxLength={64} />
      ) : (
        <Field key="totp" label={m.two_factor_code_label()} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" required maxLength={8} />
      )}
      <FormMessage error={error} />
      <Button type="submit" disabled={busy}>
        {m.two_factor_submit()}
      </Button>
      <Button type="button" variant="link" onClick={() => (setBackup(!backup), setError(null))}>
        {backup ? m.two_factor_use_app() : m.two_factor_use_backup()}
      </Button>
    </form>
  )
}
