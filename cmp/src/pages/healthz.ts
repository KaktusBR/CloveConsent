import type { APIRoute } from 'astro'

export const prerender = false

/** Liveness: the process is up. Touches nothing else. */
export const GET: APIRoute = () =>
  new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
