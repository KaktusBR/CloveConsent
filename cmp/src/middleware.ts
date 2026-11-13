import { defineMiddleware } from 'astro:middleware'
import { AsyncLocalStorage } from 'node:async_hooks'

import { localeOfPath, type Locale } from './i18n/locale'
import { overwriteServerAsyncLocalStorage } from './paraglide/runtime.js'
import { log } from './server/log'
import { checkOrigin, withSecurityHeaders } from './server/security'

// No static import of ./server/env here: this module also runs when pages are prerendered at build
// time, without the server's environment. The built server validates it before listening (astro.config.mjs).

/** Probes that run without auth and are not logged per request (they are polled). */
const PROBES = new Set(['/healthz', '/readyz'])

/** Paraglide's `getLocale()`, and so every `m.*()` rendered for a request, reads the request's locale from here. */
const requestLocale = new AsyncLocalStorage<{ locale?: Locale }>()
overwriteServerAsyncLocalStorage(requestLocale)

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url

  // The language is the URL's: `/sk/...` is Slovak, everything else English (src/pages/[...locale]/ has
  // a route for each). This also runs when pages are prerendered, so static pages get their language too.
  const locale = localeOfPath(pathname)
  context.locals.locale = locale
  // Prerendered pages get their headers where they are served (astro.config.mjs).
  if (context.isPrerendered) return requestLocale.run({ locale }, () => next())

  const started = performance.now()
  const requestId = crypto.randomUUID()
  context.locals.requestId = requestId
  context.locals.log = log.child({ requestId })

  // CSRF: a state-changing request must come from a page of this site.
  const { env } = await import('./server/env')
  const response = checkOrigin(context.request, env.PUBLIC_ORIGIN)
    ? await requestLocale.run({ locale }, () => next())
    : new Response(null, { status: 403, headers: { 'Cache-Control': 'no-store' } })

  const secured = withSecurityHeaders(response)
  secured.headers.set('X-Request-Id', requestId)

  if (!PROBES.has(pathname)) {
    context.locals.log.info(
      { method: context.request.method, path: pathname, status: secured.status, ms: Math.round(performance.now() - started) },
      'request',
    )
  }
  return secured
})
