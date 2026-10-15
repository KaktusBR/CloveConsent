const TAG_CHARS = /^[A-Za-z0-9-]{1,35}$/

/** Canonical BCP 47 form of a language tag (`pt-br` becomes `pt-BR`), or null when it is not a valid tag. */
export function canonicalLocale(tag: unknown): string | null {
  if (typeof tag !== 'string' || !TAG_CHARS.test(tag)) return null
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null
  } catch {
    return null
  }
}

/** `zh-Hant-TW` gives `['zh-Hant-TW', 'zh-Hant', 'zh']`: the tag and each shorter prefix, longest first. */
export function localePrefixes(tag: string): string[] {
  const parts = tag.split('-')
  const out: string[] = []
  for (let n = parts.length; n >= 1; n--) out.push(parts.slice(0, n).join('-'))
  return out
}

/** Lookup order for a visitor's locale: its prefixes, then the site default, then English. */
export function localeChain(locale: string, defaultLocale: string): string[] {
  return [...new Set([...localePrefixes(locale), defaultLocale, 'en'])]
}
