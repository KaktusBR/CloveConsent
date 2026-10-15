import type { Category, FirstPartyEntry } from '../schema'
import { CATALOG, L } from './helpers'

export function theme(o: { category?: Category } = {}): FirstPartyEntry {
  return {
    ...CATALOG, kind: 'first-party', id: 'theme', catalogRevision: 1, lastVerified: '2026-10-14',
    category: o.category ?? 'functional',
    storage: [{
      name: 'theme', type: 'localStorage',
      expiry: L('Trvalo (kým ho nezmažete)', 'Persistent (until you delete it)', 'Permanent (jusqu’à suppression)', 'Dauerhaft (bis zum Löschen)'),
      purpose: L('Pamätá si svetlý alebo tmavý vzhľad.', 'Remembers light or dark appearance.', 'Mémorise l’apparence claire ou sombre.', 'Merkt sich das helle oder dunkle Design.'),
    }],
    messages: {
      title: L('Vzhľad stránky', 'Site theme', 'Thème du site', 'Seitendesign'),
      description: L('Uloží vašu voľbu svetlého alebo tmavého vzhľadu.', 'Saves your light or dark theme choice.', 'Enregistre votre choix de thème clair ou sombre.', 'Speichert Ihre Wahl des hellen oder dunklen Designs.'),
    },
  }
}
