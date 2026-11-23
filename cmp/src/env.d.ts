declare namespace App {
  interface Locals {
    /** A fresh id for this request, also sent back as `X-Request-Id`. */
    requestId: string
    /** The process logger bound to this request's id. */
    log: import('./server/log').Logger
    /** The language of this page: its URL prefix (`/sk/...`), else English (src/i18n/locale.ts). */
    locale: import('./i18n/locale').Locale
    /**
     * The signed-in person's complete session (src/server/auth/complete.ts), or null. Set by the
     * middleware for every request it serves except /api/auth/* and the probes.
     */
    session?: import('./server/auth/auth').AuthSession | null
    /**
     * The account this request works in and the person's role there: the session's active account (else
     * their oldest), checked against the memberships in the database on every request. Null when signed
     * out or a member of no account. Set with `session`.
     */
    scope?: import('./server/data/scope').AccountScope | null
    /**
     * What the scope's account has paid for (src/server/data/entitlements.ts), read from the database on
     * every request; null without a scope. Set with `session`.
     */
    entitlement?: import('./server/data/entitlements').Entitlement | null
  }
}
