import { defineMiddleware } from 'astro:middleware'
import { AsyncLocalStorage } from 'node:async_hooks'

import { localeOfPath, type Locale } from './i18n/locale'
import { overwriteServerAsyncLocalStorage } from './paraglide/runtime.js'
import { log, pathForLog } from './server/log'
import { checkOrigin, stripInternalHeaders, withSecurityHeaders } from './server/security'

// No static import of ./server/env here: this module also runs when pages are prerendered at build
// time, without the server's environment. The built server validates it before listening (astro.config.mjs).

/** Probes that run without auth and are not logged per request (they are polled). */
const PROBES = new Set(['/healthz', '/readyz'])
/** Better Auth's own endpoints read the session themselves. */
const AUTH_API = '/api/auth/'

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

  // a header only this app may set (the client address for Better Auth): never the client's
  stripInternalHeaders(context.request.headers)

  const started = performance.now()
  const requestId = crypto.randomUUID()
  context.locals.requestId = requestId
  context.locals.log = log.child({ requestId })

  // CSRF: a state-changing request must come from a page of this site.
  const { env } = await import('./server/env')
  const allowed = checkOrigin(context.request, env.PUBLIC_ORIGIN)

  // Who is signed in, and the account they work in: read from the database on every request (a removed
  // member loses the account on their next request; the role is never taken from a cookie).
  const refreshed = new Headers()
  if (allowed && !PROBES.has(pathname) && !pathname.startsWith(AUTH_API)) {
    const { signedInScope } = await import('./server/auth/guard')
    const { session, scope } = await signedInScope(context.request.headers, refreshed)
    context.locals.session = session
    context.locals.scope = scope
  }

  const response = allowed
    ? await requestLocale.run({ locale }, () => next())
    : new Response(null, { status: 403, headers: { 'Cache-Control': 'no-store' } })

  const secured = withSecurityHeaders(response)
  // a sliding session's renewed cookie (src/server/auth/guard.ts)
  for (const cookie of refreshed.getSetCookie()) secured.headers.append('Set-Cookie', cookie)
  secured.headers.set('X-Request-Id', requestId)

  if (!PROBES.has(pathname)) {
    context.locals.log.info(
      { method: context.request.method, path: pathForLog(pathname), status: secured.status, ms: Math.round(performance.now() - started) },
      'request',
    )
  }
  return secured
})
