import { canonicalLocale, localePrefixes } from './i18n/locale'

/**
 * Picks the language to show from the enabled ones: the page's `<html lang>` first (exact tag, then its shorter prefixes, so `de-AT`
 * gives `de`), then the visitor's preferred languages in order, then `fallback`. Returns an enabled tag exactly as written in
 * `available`, or `fallback` as given.
 */
export function pickLocale(available: readonly string[], htmlLang: string | null, preferred: readonly string[], fallback: string): string {
  const byCanonical = new Map<string, string>()
  for (const a of available) {
    const c = canonicalLocale(a)
    if (c !== null && !byCanonical.has(c)) byCanonical.set(c, a)
  }
  for (const wanted of [htmlLang, ...preferred]) {
    const tag = canonicalLocale(wanted)
    if (tag === null) continue
    for (const p of localePrefixes(tag)) {
      const hit = byCanonical.get(p)
      if (hit !== undefined) return hit
    }
  }
  return fallback
}
