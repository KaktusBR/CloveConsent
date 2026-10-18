import * as catalog from '../../../src/catalog/index'
import type { ProcessorEntry, ServiceEntry } from '../../../src/schema'

export type Entry = ServiceEntry | ProcessorEntry

// Factories that need arguments get these; the admin shows them with a "sample args" badge.
export const SAMPLE_ARGS: Record<string, unknown> = {
  hosting: { name: 'Example Host (sample)', privacyUrl: 'https://example.com/privacy', location: { en: 'Sample location' } },
}

export interface CatalogItem {
  name: string                 // export name, e.g. 'cloudflareCdn' - the stable key used everywhere in admin
  sample: boolean              // true when built from SAMPLE_ARGS
  entry: Entry | null
  error: string | null         // message of whatever the factory threw
  create(args?: unknown): Entry
}

export function listCatalog(mod: Record<string, unknown> = catalog): CatalogItem[] {
  return Object.keys(mod)
    .filter((name) => typeof mod[name] === 'function')
    .sort()
    .map((name) => {
      const fn = mod[name] as (args?: unknown) => Entry
      const sample = name in SAMPLE_ARGS
      const create = (args?: unknown) => fn(args)
      try {
        return { name, sample, entry: create(SAMPLE_ARGS[name]), error: null, create }
      } catch (e) {
        return { name, sample, entry: null, error: e instanceof Error ? e.message : String(e), create }
      }
    })
}
