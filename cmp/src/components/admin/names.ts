// Translated names for the paywall and the super-admin console: entitlement states, and plans by the
// catalog key their row names (plans are data: a new plan brings its `name_key` into messages/*.json).
import { m } from '@/paraglide/messages.js'
import type { EntitlementState } from '@/server/data/entitlements'

const STATES: Readonly<Record<EntitlementState, () => string>> = {
  active: m.entitlement_state_active,
  grace: m.entitlement_state_grace,
  'necessary-only': m.entitlement_state_necessary_only,
  none: m.entitlement_state_none,
}

export const stateName = (state: EntitlementState): string => STATES[state]()

const messages = m as unknown as Readonly<Record<string, (() => string) | undefined>>

/** A plan's name from its catalog key; the key itself when the catalog has none. */
export const planName = (plan: { nameKey: string }): string => messages[plan.nameKey]?.() ?? plan.nameKey
