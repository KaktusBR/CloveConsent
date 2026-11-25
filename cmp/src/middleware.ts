import { defineMiddleware } from 'astro:middleware'
import { AsyncLocalStorage } from 'node:async_hooks'

import { localeOfPath, type Locale } from './i18n/locale'
import { overwriteServerAsyncLocalStorage } from './paraglide/runtime.js'
import type { Access } from './server/auth/access'
import { log, pathForLog } from './server/log'
import { checkOrigin, stripInternalHeaders, withDevPolicy, withSecurityHeaders } from './server/security'

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
  if (context.isPrerendered) {
    const page = await requestLocale.run({ locale }, () => next())
    return import.meta.env.DEV ? withDevPolicy(page) : page
  }

  // a header only this app may set (the client address for Better Auth): never the client's
  stripInternalHeaders(context.request.headers)

  const started = performance.now()
  const requestId = crypto.randomUUID()
  context.locals.requestId = requestId
  context.locals.log = log.child({ requestId })

  // CSRF: a state-changing request must come from a page of this site.
  const { env } = await import('./server/env')
  const allowed = checkOrigin(context.request, env.PUBLIC_ORIGIN)

  // Who is signed in, the account they work in and what it has paid for: read from the database on every
  // request (a removed member loses the account, an account marked paid gets in, on their next request;
  // nothing is taken from a cookie but the session). Then the access rules (src/server/auth/access.ts):
  // impersonation is read-only, the super-admin console is a 404 for anyone else, an account that has not
  // paid gets the paywall. Better Auth's endpoints read the session themselves (and refuse writes from an
  // impersonating session: src/server/auth/auth.ts).
  const refreshed = new Headers()
  let access: Access = { kind: 'pass' }
  if (allowed && !PROBES.has(pathname) && !pathname.startsWith(AUTH_API)) {
    const { requestAccess } = await import('./server/auth/guard')
    const found = await requestAccess(context.request, refreshed)
    context.locals.session = found.session
    context.locals.scope = found.scope
    context.locals.entitlement = found.entitlement
    access = found.access
  }

  const response = allowed
    ? await requestLocale.run({ locale }, () => answer(access, pathname, next))
    : new Response(null, { status: 403, headers: { 'Cache-Control': 'no-store' } })

  // astro dev: Vite's unhashed scripts and styles need a looser policy (src/server/security.ts devCsp)
  const secured = import.meta.env.DEV ? withDevPolicy(withSecurityHeaders(response)) : withSecurityHeaders(response)
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

/** The response for a request the access rules have decided on. */
function answer(access: Access, pathname: string, next: (rewrite?: string) => Promise<Response>): Promise<Response> | Response {
  const noStore = { 'Cache-Control': 'no-store' }
  switch (access.kind) {
    case 'pass':
      return next()
    case 'not-found':
      // the 404 page, exactly as for a page that does not exist; an endpoint's 404 has no body
      return pathname.startsWith('/api/') ? new Response(null, { status: 404, headers: noStore }) : next('/404')
    case 'see-other':
      return new Response(null, { status: 303, headers: { ...noStore, Location: access.location } })
    case 'refuse':
      return Response.json({ code: access.code }, { status: access.status, headers: noStore })
  }
}
