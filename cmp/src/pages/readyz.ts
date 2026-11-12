import type { APIRoute } from 'astro'
import { databaseAnswers } from '../server/data/ready'

export const prerender = false

/** Readiness: 200 when the database answers `select 1`, else 503. */
export const GET: APIRoute = async () => {
  const ready = await databaseAnswers()
  return new Response(ready ? 'ready' : 'unavailable', {
    status: ready ? 200 : 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
