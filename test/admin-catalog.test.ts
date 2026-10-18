import { expect, test } from 'vitest'
import { cloudflareCdn } from '../src/catalog/index'
import { listCatalog } from '../admin/src/lib/catalog'

test('lists every catalog export', async () => {
  const mod = (await import('../src/catalog/index')) as Record<string, unknown>
  const expected = Object.keys(mod).filter((k) => typeof mod[k] === 'function').sort()
  expect(listCatalog().map((i) => i.name)).toEqual(expected)
})

test('hosting is built from sample args', () => {
  const items = listCatalog()
  const hosting = items.find((i) => i.name === 'hosting')
  const youtube = items.find((i) => i.name === 'youtube')
  expect(hosting?.sample).toBe(true)
  expect(hosting?.entry && 'provider' in hosting.entry && hosting.entry.provider.name).toBe('Example Host (sample)')
  expect(youtube?.sample).toBe(false)
  expect(youtube?.entry?.id).toBe('youtube')
})

test('a throwing factory becomes an error row', () => {
  const items = listCatalog({
    ok: () => cloudflareCdn(),
    bad: () => { throw new Error('boom') },
  })
  const bad = items.find((i) => i.name === 'bad')
  expect(bad?.entry).toBeNull()
  expect(bad?.error).toBe('boom')
  expect(items.find((i) => i.name === 'ok')?.entry).not.toBeNull()
})
