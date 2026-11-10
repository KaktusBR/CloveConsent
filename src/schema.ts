import type { LocalePack } from './i18n/pack'
import type { Messages } from './messages'
import type { UiSettings, UiSettingsInput } from './ui-settings'

/** Any BCP 47 language tag in canonical form, for example `en`, `sk`, `pt-BR`. */
export type Locale = string
/** A text in several languages. `en` (the source language) is required; other languages are optional. */
export interface Localised { en: string; [locale: string]: string | undefined }

export const CATEGORIES = ['necessary', 'functional', 'media', 'social', 'analytics', 'marketing'] as const
export type Category = (typeof CATEGORIES)[number]

export type StorageType = 'cookie' | 'localStorage' | 'sessionStorage'
export interface StorageItem {
  name: string
  /** Pack lookup key used instead of `name`, for names with a per-site part such as `_ga_ABC1234`. */
  translationKey?: string
  type: StorageType
  expiry: Localised
  purpose: Localised
}
export interface Provider { name: string; privacyUrl: string }

/** A small setup step the library runs itself, as library code, after it loads a provider script (keeps a strict CSP working). */
export type ScriptInit = { kind: 'gtag'; id: string } | { kind: 'gtm' } | { kind: 'fbq'; id: string }

export type Gating =
  | { type: 'none' }
  | { type: 'script'; src: string; init?: ScriptInit }
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
  /** Category id -> accepted service ids. `null` means the cookie has no `services` field (written before per-service consent). */
  services: Record<string, string[]> | null
  timestamp: string | null
}
export interface DecisionInfo {
  /**
   * `first`: the first answer ever. `change`: categories or services changed. `reconfirm`: the visitor re-confirmed after a
   * re-consent prompt without changing anything. `withdraw`: the visitor withdrew all consent (`consent.withdraw()`).
   */
  kind: 'first' | 'change' | 'reconfirm' | 'withdraw'
  /** Optional categories whose acceptance changed (for `first`: the categories accepted). */
  changed: Category[]
  /**
   * Service ids whose acceptance changed (turned on or off). For `first`: the services accepted. For `withdraw`: every
   * service that was accepted before the withdrawal.
   */
  changedServices: string[]
  /** The language the visitor saw the banner in. With reference, time and policy version from the state this is a full consent record. */
  locale: Locale
}
export interface ConsentHooks {
  /** Fires on every page load that has a stored decision, and after each decision. Not suitable for writing consent records. */
  onReady?(state: ConsentState): void
  /** Fires exactly once per decision the visitor makes. Use this for consent records. */
  onDecision?(state: ConsentState, info: DecisionInfo): void
}
export interface ConsentConfigInput {
  locales: Locale[]
  defaultLocale: Locale
  revision: number
  cookieName?: string
  /**
   * Hostname the consent cookie is shared across (for example `example.com` for `www.example.com` and `shop.example.com`).
   * Used only when the page's host is that name or a subdomain of it; otherwise it is ignored with a dev warning.
   */
  cookieDomain?: string
  /** Where the browser posts consent records: an https URL or a path on the page's own origin (plain http only for localhost). */
  records?: { url: string }
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
  /** Banner, dialog, manager and theme settings. Every key is optional; see DEFAULT_UI. */
  ui?: UiSettingsInput
}
export interface ConsentConfig {
  readonly locales: readonly Locale[]
  readonly defaultLocale: Locale
  readonly revision: number
  readonly cookieName: string
  readonly cookieDomain: string | null
  readonly records: { readonly url: string } | null
  readonly darkMode: boolean
  readonly privacyHref: string | null
  readonly services: readonly ServiceEntry[]
  readonly processors: readonly ProcessorEntry[]
  readonly hooks: ConsentHooks
  /** Resolved banner texts for every enabled language. */
  readonly messages: Readonly<Record<Locale, Messages>>
  /** Enabled languages whose pack is flagged `reviewed: false`. */
  readonly unreviewed: readonly Locale[]
  /** Resolved, validated ui settings. */
  readonly ui: UiSettings
}
