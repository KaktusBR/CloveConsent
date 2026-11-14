// Building blocks of the auth forms: a labelled field and the form's message line. Texts come from the
// caller (the catalog); nothing here is user-facing on its own.
import { useId, type ComponentProps, type SubmitEvent, type ReactNode } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { m } from '@/paraglide/messages.js'

interface FieldProps extends Omit<ComponentProps<'input'>, 'id'> {
  label: string
  /** A hint under the field (e.g. the password rule). */
  hint?: string | undefined
}

/** A labelled input; its hint is its accessible description. */
export function Field({ label, hint, ...input }: FieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-describedby={hint ? hintId : undefined} {...input} />
      {hint && (
        <p id={hintId} className="text-muted-foreground text-sm">
          {hint}
        </p>
      )}
    </div>
  )
}

/** The form's outcome: an error (announced at once) or a confirmation (announced politely). */
export function FormMessage({ error, success }: { error?: string | null | undefined; success?: ReactNode }) {
  return (
    <>
      <div role="alert" className="text-destructive text-sm font-medium empty:hidden">
        {error}
      </div>
      <div role="status" className="text-sm empty:hidden">
        {success}
      </div>
    </>
  )
}

/** Run an async submit with the form's busy flag; the handler returns an error text or null. */
export function submitting(setBusy: (busy: boolean) => void, setError: (error: string | null) => void, run: (form: FormData) => Promise<string | null>) {
  return async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError(null)
    try {
      setError(await run(form))
    } catch {
      // network failure: the library's or the browser's text is never shown
      setError(m.auth_error_generic())
    } finally {
      setBusy(false)
    }
  }
}
