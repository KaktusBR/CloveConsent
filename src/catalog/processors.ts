import type { Localised, ProcessorEntry } from '../schema'
import { CATALOG } from './helpers'

// Sources and what could not be confirmed: docs/concepts/the-catalog.md. lastVerified is set only where every fact
// in the entry (data categories, location, transfers, privacy URL) is backed by the provider's own documentation.
const base = { ...CATALOG, kind: 'processor' as const, catalogRevision: 1 }

export function resend(): ProcessorEntry {
  return {
    ...base, lastVerified: '2026-10-14', id: 'resend',
    provider: { name: 'Resend', privacyUrl: 'https://resend.com/legal/privacy-policy' },
    purpose: { en: 'Sending e-mails from forms.' },
    dataCategories: [{ en: 'E-mail address' }, { en: 'Message content' }, { en: 'E-mail metadata' }],
    location: { en: 'United States (stored data). The sending region (for example Ireland) only sets where e-mails are sent from, not where data is stored.' },
    transfers: { en: 'Transfers to the United States: Standard Contractual Clauses and the EU-U.S. Data Privacy Framework.' },
  }
}
export function cloudflareCdn(): ProcessorEntry {
  return {
    ...base, lastVerified: '2026-10-14', id: 'cloudflare-cdn',
    provider: { name: 'Cloudflare', privacyUrl: 'https://www.cloudflare.com/privacypolicy/' },
    purpose: { en: 'Delivering and protecting the site (CDN, attack protection).' },
    dataCategories: [{ en: 'IP address' }, { en: 'Technical request data' }],
    location: { en: 'Cloudflare global network (data stored primarily in the United States and the EEA)' },
  }
}
export function facebookGraph(): ProcessorEntry {
  return {
    ...base, lastVerified: null, id: 'facebook-graph',
    provider: { name: 'Meta (Facebook Graph API)', privacyUrl: 'https://www.facebook.com/privacy/policy/' },
    purpose: { en: 'Fetching posts from our Facebook page. Post images load from the address the Graph API returns (Meta servers), so Meta receives the visitor’s IP address.' },
    dataCategories: [{ en: 'IP address (when loading images)' }],
    location: { en: 'Per Meta: United States, Ireland, Denmark, Sweden and other countries' },
  }
}
export function hosting(o: { name: string; privacyUrl: string; location: Localised }): ProcessorEntry {
  return {
    ...base, lastVerified: null, id: 'hosting',
    provider: { name: o.name, privacyUrl: o.privacyUrl },
    purpose: { en: 'Running the website.' },
    dataCategories: [{ en: 'IP address' }, { en: 'Server logs' }],
    location: o.location,
  }
}
