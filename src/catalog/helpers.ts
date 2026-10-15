import type { Localised } from '../schema'
export const L = (sk: string, en: string, fr: string, de: string): Localised => ({ sk, en, fr, de })
export const CATALOG = { fromCatalog: true as const, unreviewed: ['fr', 'de'] as ('fr' | 'de')[] }
