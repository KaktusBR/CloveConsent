import type { LocalePack } from './i18n/pack'
import type { Messages } from './messages'

/** Any BCP 47 language tag in canonical form, for example `en`, `sk`, `pt-BR`. */
export type Locale = string
/** A text in several languages. `en` (the source language) is required; other languages are optional. */
export interface Localised { en: string; [locale: string]: string | undefined }

export const CATEGORIES = ['necessary', 'functional', 'media', 'social', 'analytics', 'marketing'] as const
export type Category = (typeof CATEGORIES)[number]

export type StorageType = 'cookie' | 'localStorage' | 'sessionStorage'
export interface StorageItem { name: string; type: StorageType; expiry: Localised; purpose: Localised }
export interface Provider { name: string; privacyUrl: string }

export type Gating =
  | { type: 'none' }
  | { type: 'script'; src: string }
  | { type: 'iframe'; sandbox?: string }

export type CspExtras = Partial<Record<'script-src' | 'frame-src' | 'connect-src' | 'img-src', string[]>>

interface EntryBase {
  id: string
  catalogRevision: number
  lastVerified: string | null
  fromCatalog?: true
}
export interface EntryMessages { title: Localised; description: Localised }

export interface ClientEntry extends EntryBase {
  kind: 'client'
  category: Category
  provider: Provider
  storage: StorageItem[]
  gating: Gating
  origins: string[]
  csp?: CspExtras
  messages: EntryMessages
  notes?: string
}
export interface FirstPartyEntry extends EntryBase {
  kind: 'first-party'
  category: Category
  storage: StorageItem[]
  messages: EntryMessages
}
export interface ProcessorEntry extends EntryBase {
  kind: 'processor'
  provider: Provider
  purpose: Localised
  dataCategories: Localised[]
  location: Localised
  dpaUrl?: string
  transfers?: Localised
}
export type ServiceEntry = ClientEntry | FirstPartyEntry

export interface ConsentState {
  consentId: string
  categories: Category[]               // accepted, always includes 'necessary'
  siteRevision: number | null
  revisions: Record<string, number>
  timestamp: string | null
}
export interface ConsentHooks {
  onFirstConsent?(state: ConsentState): void
  onChange?(state: ConsentState, changed: Category[]): void
  /** Fires on every page load that has a stored decision (and with onFirstConsent on a first decision). Not suitable for writing consent records. */
  onConsent?(state: ConsentState): void
}
export interface ConsentConfigInput {
  locales: Locale[]
  defaultLocale: Locale
  revision: number
  cookieName?: string
  darkMode?: boolean
  privacyHref?: string
  services: ServiceEntry[]
  processors?: ProcessorEntry[]
  hooks?: ConsentHooks
  /** Language packs for every enabled language except English (`en` is built in). */
  packs?: LocalePack[]
  /** Per-language overrides of individual banner texts. Highest priority. */
  messages?: Record<Locale, Partial<Messages>>
  /** Show the fallback language for missing translations (with a dev warning) instead of failing the build. Default false. */
  allowFallback?: boolean
}
export interface ConsentConfig {
  readonly locales: readonly Locale[]
  readonly defaultLocale: Locale
  readonly revision: number
  readonly cookieName: string
  readonly darkMode: boolean
  readonly privacyHref: string | null
  readonly services: readonly ServiceEntry[]
  readonly processors: readonly ProcessorEntry[]
  readonly hooks: ConsentHooks
  /** Resolved banner texts for every enabled language. */
  readonly messages: Readonly<Record<Locale, Messages>>
  /** Enabled languages whose pack is flagged `reviewed: false`. */
  readonly unreviewed: readonly Locale[]
}
