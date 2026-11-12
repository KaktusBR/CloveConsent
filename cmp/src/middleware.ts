import { defineMiddleware } from 'astro:middleware'
import './server/env' // validate the environment as soon as the server loads, not on first use
import { log } from './server/log'

/** Probes that run without auth and are not logged per request (they are polled). */
const PROBES = new Set(['/healthz', '/readyz'])

export const onRequest = defineMiddleware(async (context, next) => {
  const started = performance.now()
  const requestId = crypto.randomUUID()
  context.locals.requestId = requestId
  context.locals.log = log.child({ requestId })

  const response = await next()
  response.headers.set('X-Request-Id', requestId)

  if (!PROBES.has(context.url.pathname)) {
    context.locals.log.info(
      { method: context.request.method, path: context.url.pathname, status: response.status, ms: Math.round(performance.now() - started) },
      'request',
    )
  }
  return response
})
