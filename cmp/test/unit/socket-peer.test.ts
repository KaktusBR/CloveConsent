import { describe, expect, test } from 'vitest'

import { SOCKET_PEER_HEADER, socketPeer, socketPeerDevMiddleware, stampSocketPeer } from '../../src/server/socket-peer'

type NodeRequest = Parameters<typeof stampSocketPeer>[0]

const nodeRequest = (headers: NodeRequest['headers'], remoteAddress?: string): NodeRequest => ({ headers, socket: { remoteAddress } })

describe('the TCP peer as an internal request header', () => {
  test('the socket address replaces any copy the client sent', () => {
    const req = nodeRequest({ host: 'localhost', [SOCKET_PEER_HEADER]: '6.6.6.6' }, '203.0.113.7')
    stampSocketPeer(req)
    expect(req.headers[SOCKET_PEER_HEADER]).toBe('203.0.113.7')
  })

  test('without a socket address the header is absent (the request is then refused), even if the client sent one', () => {
    const req = nodeRequest({ [SOCKET_PEER_HEADER]: ['6.6.6.6', '7.7.7.7'] })
    stampSocketPeer(req)
    expect(SOCKET_PEER_HEADER in req.headers).toBe(false)
  })

  test('the dev server middleware does the same for every request, then passes it on', () => {
    const req = nodeRequest({ [SOCKET_PEER_HEADER]: '6.6.6.6' }, '::1')
    let called = false
    socketPeerDevMiddleware(req, {}, () => {
      called = true
    })
    expect(called).toBe(true)
    expect(req.headers[SOCKET_PEER_HEADER]).toBe('::1')
  })

  test('socketPeer reads it from the web Request (it survives Astro rebuilding the Request: it is a header)', () => {
    const request = new Request('http://localhost/api/auth/ok', { headers: { [SOCKET_PEER_HEADER]: '203.0.113.7' } })
    expect(socketPeer(new Request(request.url, request))).toBe('203.0.113.7')
    expect(socketPeer(new Request('http://localhost/'))).toBeUndefined()
  })
})
