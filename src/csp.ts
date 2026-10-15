import type { ConsentConfig } from './schema'

type Dir = 'script-src' | 'frame-src' | 'connect-src' | 'img-src'

export function cspSources(config: ConsentConfig): Record<Dir, string[]> {
  const sets: Record<Dir, Set<string>> = { 'script-src': new Set(), 'frame-src': new Set(), 'connect-src': new Set(), 'img-src': new Set() }
  for (const s of config.services) {
    if (s.kind !== 'client') continue
    if (s.gating.type === 'script') sets['script-src'].add(new URL(s.gating.src).hostname)
    if (s.gating.type === 'iframe') for (const h of s.origins) sets['frame-src'].add(h)
    for (const [dir, hosts] of Object.entries(s.csp ?? {})) for (const h of hosts ?? []) sets[dir as Dir].add(h)
  }
  const out = {} as Record<Dir, string[]>
  for (const k of Object.keys(sets) as Dir[]) out[k] = [...sets[k]].sort()
  return out
}
