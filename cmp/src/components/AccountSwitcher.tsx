import { useId } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { m } from '@/paraglide/messages.js'

interface Props {
  /** The person's accounts. */
  accounts: { id: string; name: string }[]
  /** The account this page is in. */
  activeId: string
}

/**
 * Switches the account the person works in: a plain form (no JavaScript needed). The server checks the
 * membership and answers 404 for an account that is not theirs, leaving the active account as it was.
 */
export default function AccountSwitcher({ accounts, activeId }: Props) {
  const id = useId()
  return (
    <form method="post" action="/api/account/switch" className="flex flex-wrap items-end gap-2">
      <div className="grid gap-2">
        <Label htmlFor={id}>{m.account_switcher_label()}</Label>
        <NativeSelect id={id} name="account" defaultValue={activeId} className="w-auto min-w-48">
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" variant="outline">
        {m.account_switcher_submit()}
      </Button>
    </form>
  )
}
