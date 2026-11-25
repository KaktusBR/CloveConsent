// The request-body limit (finding I1). The node adapter's own default is 1 GiB while the app's container has
// 512 MB, and Better Auth reads the whole body of every /api/auth/* POST (no session needed, and a forged
// Origin passes for a client that is not a browser): one large POST could stop the app.
//
// The node adapter's request handler calls bufferRequestBody before Astro builds its Request (a build patch,
// astro.config.mjs): a body over MAX_REQUEST_BODY is refused with 413 before anything reads it, by its
// Content-Length, or once that many bytes of a chunked body have arrived; a body within it is read into
// memory and handed to Astro whole. The adapter's bodySizeLimit is the same number, a second line.
// A route that needs more (none yet) must raise it for itself. Behind Traefik, a body limit there too is
// optional (docs/deploy-dokploy.md).
//
// No import of the server's environment: astro.config.mjs loads this module.

/** The largest request body the app accepts, in bytes. */
export const MAX_REQUEST_BODY = 64 * 1024

/** The parts of a Node IncomingMessage used here. */
interface NodeRequest {
  method?: string | undefined
  headers: Record<string, string | string[] | undefined>
  body?: unknown
  on(event: 'data', listener: (chunk: Buffer) => void): unknown
  on(event: 'end', listener: () => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  off(event: string, listener: (...args: never[]) => void): unknown
  pause(): unknown
}

/** The parts of a Node ServerResponse used here (its security headers are already set). */
interface NodeResponse {
  statusCode: number
  setHeader(name: string, value: string): unknown
  end(): unknown
}

function refuse(res: NodeResponse): true {
  res.statusCode = 413
  res.setHeader('Cache-Control', 'no-store')
  // the rest of the body is not read: the connection ends with this answer
  res.setHeader('Connection', 'close')
  res.end()
  return true
}

/**
 * For a request with a body (any method but GET and HEAD, which Astro gives none): answers 413 and returns
 * true when the body is over `limit` bytes; else reads it whole into `req.body` (where the adapter takes it
 * from) and returns false. Never holds more than `limit` bytes of a request.
 */
export function bufferRequestBody(req: NodeRequest, res: NodeResponse, limit: number = MAX_REQUEST_BODY): Promise<boolean> {
  if (req.method === 'GET' || req.method === 'HEAD') return Promise.resolve(false)
  const declared = req.headers['content-length']
  if (typeof declared === 'string' && !(Number(declared) <= limit)) return Promise.resolve(refuse(res))
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const done = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
    }
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size <= limit) return void chunks.push(chunk)
      done()
      req.pause()
      resolve(refuse(res))
    }
    const onEnd = () => {
      done()
      req.body = Buffer.concat(chunks)
      resolve(false)
    }
    const onError = (err: Error) => {
      done()
      reject(err)
    }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}
