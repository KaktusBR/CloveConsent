import { defineMiddleware } from 'astro:middleware'
import { AsyncLocalStorage } from 'node:async_hooks'

import { baseLocale, localizedPath, LOCALE_COOKIE, resolveLocale, splitLocalePrefix, type Locale } from './i18n/locale'
import { overwriteServerAsyncLocalStorage } from './paraglide/runtime.js'
import { env } from './server/env' // validate the environment as soon as the server loads, not on first use
import { log } from './server/log'

/** Probes that run without auth and are not logged per request (they are polled). */
const PROBES = new Set(['/healthz', '/readyz'])

/** Paraglide's `getLocale()`, and so every `m.*()` rendered for a request, reads the request's locale from here. */
const requestLocale = new AsyncLocalStorage<{ locale?: Locale; origin?: string }>()
overwriteServerAsyncLocalStorage(requestLocale)

/** A browser loading a page (not a fetch of data), which may be sent to the page in its language. */
function isPageLoad(request: Request): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  const dest = request.headers.get('sec-fetch-dest')
  return dest ? dest === 'document' : (request.headers.get('accept') ?? '').includes('text/html')
}

function addVary(response: Response, ...fields: string[]): void {
  const existing = response.headers.get('Vary')
  response.headers.set('Vary', existing ? `${existing}, ${fields.join(', ')}` : fields.join(', '))
}

export const onRequest = defineMiddleware(async (context, next) => {
  const started = performance.now()
  const requestId = crypto.randomUUID()
  context.locals.requestId = requestId
  context.locals.log = log.child({ requestId })

  // Language: `/sk/...` is Slovak and is served by the unprefixed page; an unprefixed URL is English
  // unless the switcher's cookie or the browser asks for another shipped language.
  const { pathname, search } = context.url
  const prefix = splitLocalePrefix(pathname)
  const locale = resolveLocale(pathname, context.cookies.get(LOCALE_COOKIE)?.value ?? null, context.request.headers.get('accept-language'))
  context.locals.locale = locale
  const probe = PROBES.has(pathname)

  let response: Response
  if (!prefix.locale && locale !== baseLocale && !probe && isPageLoad(context.request)) {
    // The URL always names the page's language (islands read it in the browser): send the reader there.
    response = new Response(null, { status: 307, headers: { Location: localizedPath(pathname, locale) + search } })
  } else {
    response = await requestLocale.run({ locale, origin: env.PUBLIC_ORIGIN }, () => (prefix.locale ? next(prefix.path + search) : next()))
  }
  if (!prefix.locale && !probe) addVary(response, 'Cookie', 'Accept-Language')
  response.headers.set('X-Request-Id', requestId)

  if (!probe) {
    context.locals.log.info(
      { method: context.request.method, path: pathname, status: response.status, ms: Math.round(performance.now() - started) },
      'request',
    )
  }
  return response
})
