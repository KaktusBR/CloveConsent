// Static server for the browser fixtures: the pages, the site's scripts, the harness bundle and the site scripts built in globalSetup.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const out = join(here, '..', '.out')
const port = Number(process.env.PORT ?? 4317)
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }
const files = {
  '/parsed.html': join(here, 'parsed.html'),
  '/parsed-iframe.html': join(here, 'parsed-iframe.html'),
  '/dynamic.html': join(here, 'dynamic.html'),
  '/lazy.html': join(here, 'lazy.html'),
  '/cases.js': join(here, 'cases.js'),
  '/done.js': join(here, 'done.js'),
  '/harness.js': join(out, 'harness.js'),
  '/site.html': join(here, 'site.html'),
  '/site.js': join(out, 'site.js'),
  '/blocking.html': join(here, 'blocking.html'),
  '/blocking.js': join(out, 'blocking.js'),
  '/blocking-inserted.js': join(here, 'blocking-inserted.js'),
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`)
  if (url.pathname === '/health') { res.end('ok'); return }
  const file = files[url.pathname]
  if (!file) { res.statusCode = 404; res.end(); return }
  let body = await readFile(file, 'utf8')
  if (url.pathname === '/dynamic.html' || url.pathname === '/lazy.html') body = body.replace('__CASE__', (url.searchParams.get('case') ?? '').replace(/[^a-z-]/g, ''))
  res.setHeader('Content-Type', types[extname(file)])
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}).listen(port)
