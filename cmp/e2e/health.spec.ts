import { expect, test } from '@playwright/test'

test('GET /healthz answers 200 ok, uncached, with a request id', async ({ request }) => {
  const res = await request.get('/healthz')
  expect(res.status()).toBe(200)
  expect(await res.text()).toBe('ok')
  expect(res.headers()['cache-control']).toBe('no-store')
  expect(res.headers()['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
})

test('GET /readyz answers 200 when the database answers, uncached', async ({ request }) => {
  // polled: the probe gives the database 2 s, which a machine busy starting every e2e browser can exceed
  await expect.poll(async () => (await request.get('/readyz')).status(), { timeout: 15_000 }).toBe(200)
  const res = await request.get('/readyz')
  expect(res.status()).toBe(200)
  expect(res.headers()['cache-control']).toBe('no-store')
})
