import { toDataURL } from 'qrcode'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { m } from '@/paraglide/messages.js'

import { Field, FormMessage, submitting } from './fields'

interface Props {
  enabled: boolean
}

interface Setup {
  qr: string
  secret: string
  backupCodes: string[]
}

/**
 * Turn two-factor authentication on (password → QR code, the secret as text and the backup codes, shown
 * once → a first code from the app confirms it) or off (password). Either way an email tells the user.
 */
export default function TwoFactorSettings({ enabled }: Props) {
  const [setup, setSetup] = useState<Setup | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reload = () => window.location.reload()

  const start = submitting(setBusy, setError, async (form) => {
    const { data, error } = await authClient.twoFactor.enable({ password: String(form.get('password')) })
    if (error || !data || !('totpURI' in data) || !data.totpURI) return authErrorMessage(error)
    setSetup({
      qr: await toDataURL(data.totpURI, { margin: 2, width: 200 }),
      secret: new URL(data.totpURI).searchParams.get('secret') ?? '',
      backupCodes: data.backupCodes ?? [],
    })
    return null
  })

  const confirm = submitting(setBusy, setError, async (form) => {
    const { error } = await authClient.twoFactor.verifyTotp({ code: String(form.get('code')).replace(/\s+/g, '') })
    if (error) return authErrorMessage(error)
    reload()
    return null
  })

  const turnOff = submitting(setBusy, setError, async (form) => {
    const { error } = await authClient.twoFactor.disable({ password: String(form.get('password')) })
    if (error) return authErrorMessage(error)
    reload()
    return null
  })

  if (enabled) {
    return (
      <form className="grid gap-4" onSubmit={turnOff}>
        <p>{m.security_two_factor_on()}</p>
        <Field label={m.auth_password_label()} name="password" type="password" autoComplete="current-password" required maxLength={128} />
        <FormMessage error={error} />
        <Button type="submit" variant="destructive" disabled={busy}>
          {m.security_two_factor_disable()}
        </Button>
      </form>
    )
  }

  if (setup) {
    return (
      <div className="grid gap-4">
        <p>{m.security_two_factor_scan()}</p>
        <img src={setup.qr} width={200} height={200} alt={m.security_two_factor_qr_alt()} className="rounded-md bg-white" />
        <p>{m.security_two_factor_secret()}</p>
        <code data-testid="totp-secret" className="bg-muted rounded px-2 py-1 font-mono break-all">
          {setup.secret}
        </code>
        <p>{m.security_backup_codes_intro()}</p>
        <ul aria-label={m.security_backup_codes_label()} className="grid grid-cols-2 gap-2 font-mono">
          {setup.backupCodes.map((code) => (
            <li key={code}>
              <code>{code}</code>
            </li>
          ))}
        </ul>
        <form className="grid gap-4" onSubmit={confirm}>
          <Field label={m.two_factor_code_label()} name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={8} />
          <FormMessage error={error} />
          <Button type="submit" disabled={busy}>
            {m.security_two_factor_confirm()}
          </Button>
        </form>
      </div>
    )
  }

  return (
    <form className="grid gap-4" onSubmit={start}>
      <p>{m.security_two_factor_off()}</p>
      <Field label={m.auth_password_label()} name="password" type="password" autoComplete="current-password" required maxLength={128} />
      <FormMessage error={error} />
      <Button type="submit" disabled={busy}>
        {m.security_two_factor_enable()}
      </Button>
    </form>
  )
}
