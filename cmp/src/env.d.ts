declare namespace App {
  interface Locals {
    /** A fresh id for this request, also sent back as `X-Request-Id`. */
    requestId: string
    /** The process logger bound to this request's id. */
    log: import('./server/log').Logger
    /** The language of this request (src/i18n/locale.ts: URL prefix, cookie, Accept-Language, then en). */
    locale: import('./i18n/locale').Locale
  }
}
