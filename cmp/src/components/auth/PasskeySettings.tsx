import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { m } from '@/paraglide/messages.js'

import { Field, FormMessage, submitting } from './fields'

export interface PasskeyItem {
  id: string
  name: string
  /** Already written out in the page's language. */
  added: string
}

interface Props {
  passkeys: PasskeyItem[]
}

/** The user's passkeys: add one (the browser asks the authenticator), or remove one. */
export default function PasskeySettings({ passkeys }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reload = () => window.location.reload()

  const add = submitting(setBusy, setError, async (form) => {
    const name = String(form.get('name')).trim()
    const result = await authClient.passkey.addPasskey({ name: name || m.security_passkey_default_name() })
    if (result?.error) return authErrorMessage(result.error)
    reload()
    return null
  })

  async function remove(id: string) {
    setBusy(true)
    setError(null)
    try {
      const { error } = await authClient.passkey.deletePasskey({ id })
      if (error) setError(authErrorMessage(error))
      else reload()
    } catch {
      setError(m.auth_error_generic())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      {passkeys.length === 0 ? (
        <p>{m.security_passkeys_none()}</p>
      ) : (
        <ul className="grid gap-2">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-4 rounded-md border p-3">
              <span>
                <span className="font-medium">{p.name}</span>{' '}
                <span className="text-muted-foreground text-sm">{m.security_passkey_added({ date: p.added })}</span>
              </span>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => remove(p.id)} aria-label={m.security_passkey_remove_named({ name: p.name })}>
                {m.security_passkey_remove()}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form className="grid gap-4" onSubmit={add}>
        <Field label={m.security_passkey_name_label()} name="name" autoComplete="off" maxLength={100} />
        <FormMessage error={error} />
        <Button type="submit" disabled={busy}>
          {m.security_passkey_add()}
        </Button>
      </form>
    </div>
  )
}
