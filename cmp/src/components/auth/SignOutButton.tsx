import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { m } from '@/paraglide/messages.js'

interface Props {
  signInHref: string
}

/** Ends this browser's session. */
export default function SignOutButton({ signInHref }: Props) {
  const [busy, setBusy] = useState(false)
  async function signOut() {
    setBusy(true)
    try {
      await authClient.signOut()
    } finally {
      window.location.assign(signInHref)
    }
  }
  return (
    <Button type="button" variant="outline" disabled={busy} onClick={signOut}>
      {m.security_sign_out()}
    </Button>
  )
}
