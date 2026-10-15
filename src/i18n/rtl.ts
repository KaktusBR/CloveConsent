const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb'])
const RTL_SCRIPTS = new Set(['arab', 'hebr', 'thaa', 'syrc', 'nkoo'])

/** True for right-to-left languages. A script subtag, when present, decides (`sd-Deva` is left-to-right). */
export function isRtl(locale: string): boolean {
  const [language = '', ...rest] = locale.toLowerCase().split('-')
  const script = rest.find((p) => p.length === 4)
  if (script !== undefined) return RTL_SCRIPTS.has(script)
  return RTL_LANGUAGES.has(language)
}
