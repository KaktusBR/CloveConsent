import type { Category } from './schema'
import type { View } from './view'

export interface StoredData { siteRevision: number; revisions: Record<string, number> }
export interface DriverHooks {
  onFirstConsent(): void
  onConsent(): void
  onChange(changed: Category[]): void
  onDecision(): void
}
export interface ConsentDriver {
  init(view: View, hooks: DriverHooks): void
  readRaw(): string | null
  writeData(data: StoredData): void
  showBanner(): void
  open(): void
  acceptAll(): void
  rejectAll(): void
  acceptCategories(categories: Category[]): void
}
