declare namespace App {
  interface Locals {
    /** A fresh id for this request, also sent back as `X-Request-Id`. */
    requestId: string
    /** The process logger bound to this request's id. */
    log: import('./server/log').Logger
    /** The language of this page: its URL prefix (`/sk/...`), else English (src/i18n/locale.ts). */
    locale: import('./i18n/locale').Locale
  }
}
