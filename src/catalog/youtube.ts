import type { Category, ClientEntry } from '../schema'
import { CATALOG, L } from './helpers'

export function youtube(o: { category?: Category } = {}): ClientEntry {
  return {
    ...CATALOG, kind: 'client', id: 'youtube', catalogRevision: 1, lastVerified: null,
    category: o.category ?? 'media',
    provider: { name: 'YouTube (Google)', privacyUrl: 'https://policies.google.com/privacy' },
    storage: [],
    gating: { type: 'iframe', sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups' },
    origins: ['www.youtube-nocookie.com'],
    csp: { 'frame-src': ['www.youtube-nocookie.com'] },
    messages: {
      title: L('Videá YouTube', 'YouTube videos', 'Vidéos YouTube', 'YouTube-Videos'),
      description: L('Vložené videá z YouTube v rozšírenom režime ochrany súkromia (youtube-nocookie.com).', 'Embedded YouTube videos in Privacy Enhanced Mode (youtube-nocookie.com).', 'Vidéos YouTube intégrées en mode de confidentialité renforcée (youtube-nocookie.com).', 'Eingebettete YouTube-Videos im erweiterten Datenschutzmodus (youtube-nocookie.com).'),
    },
    notes: 'UNVERIFIED: YouTube documents Privacy Enhanced Mode only as not personalising viewing or ads; it does not list what youtube-nocookie.com stores in the browser, so storage is empty here because it is unknown, not because it is none. The iframe sandbox value is also not confirmed against YouTube docs. See docs/catalog-verification.md.',
  }
}
