import type { ProcessorEntry } from '../schema'
import { CATALOG, L } from './helpers'

// Verification: see docs/catalog-verification.md. lastVerified is set only where every fact in the entry
// (data categories, location, transfers, privacy URL) is backed by the provider's own documentation.
const base = { ...CATALOG, kind: 'processor' as const, catalogRevision: 1 }

export function resend(): ProcessorEntry {
  return {
    ...base, lastVerified: '2026-10-14', id: 'resend',
    provider: { name: 'Resend', privacyUrl: 'https://resend.com/legal/privacy-policy' },
    purpose: L('Odosielanie e-mailov z formulárov.', 'Sending e-mails from forms.', 'Envoi d’e-mails depuis les formulaires.', 'Versand von E-Mails aus Formularen.'),
    dataCategories: [L('E-mailová adresa', 'E-mail address', 'Adresse e-mail', 'E-Mail-Adresse'), L('Obsah správy', 'Message content', 'Contenu du message', 'Nachrichteninhalt'), L('Metadáta e-mailu', 'E-mail metadata', 'Métadonnées de l’e-mail', 'E-Mail-Metadaten')],
    location: L(
      'USA (uložené údaje). Región odosielania (napr. Írsko) určuje len to, odkiaľ sa e-maily odosielajú, nie kde sa údaje ukladajú.',
      'United States (stored data). The sending region (for example Ireland) only sets where e-mails are sent from, not where data is stored.',
      'États-Unis (données stockées). La région d’envoi (par exemple l’Irlande) détermine seulement d’où les e-mails sont envoyés, pas où les données sont stockées.',
      'USA (gespeicherte Daten). Die Versandregion (z. B. Irland) legt nur fest, von wo E-Mails versendet werden, nicht wo Daten gespeichert werden.'),
    transfers: L(
      'Prenos do USA: štandardné zmluvné doložky a rámec ochrany údajov EÚ–USA.',
      'Transfers to the United States: Standard Contractual Clauses and the EU-U.S. Data Privacy Framework.',
      'Transferts vers les États-Unis : clauses contractuelles types et cadre de protection des données UE-États-Unis.',
      'Übermittlung in die USA: Standardvertragsklauseln und EU-US-Datenschutzrahmen.'),
  }
}
export function cloudflareCdn(): ProcessorEntry {
  return {
    ...base, lastVerified: '2026-10-14', id: 'cloudflare-cdn',
    provider: { name: 'Cloudflare', privacyUrl: 'https://www.cloudflare.com/privacypolicy/' },
    purpose: L('Doručovanie a ochrana stránky (CDN, ochrana pred útokmi).', 'Delivering and protecting the site (CDN, attack protection).', 'Diffusion et protection du site (CDN, protection contre les attaques).', 'Auslieferung und Schutz der Seite (CDN, Angriffsschutz).'),
    dataCategories: [L('IP adresa', 'IP address', 'Adresse IP', 'IP-Adresse'), L('Technické údaje o požiadavke', 'Technical request data', 'Données techniques de la requête', 'Technische Anfragedaten')],
    location: L(
      'Globálna sieť Cloudflare (údaje sa ukladajú primárne v USA a EHP)',
      'Cloudflare global network (data stored primarily in the United States and the EEA)',
      'Réseau mondial de Cloudflare (données stockées principalement aux États-Unis et dans l’EEE)',
      'Globales Cloudflare-Netzwerk (Daten werden überwiegend in den USA und im EWR gespeichert)'),
  }
}
export function facebookGraph(): ProcessorEntry {
  return {
    ...base, lastVerified: null, id: 'facebook-graph',
    provider: { name: 'Meta (Facebook Graph API)', privacyUrl: 'https://www.facebook.com/privacy/policy/' },
    purpose: L(
      'Načítanie príspevkov zo stránky na Facebooku. Obrázky príspevkov sa načítavajú z adresy, ktorú vráti Graph API (servery Meta), a Meta tak dostane IP adresu návštevníka.',
      'Fetching posts from our Facebook page. Post images load from the address the Graph API returns (Meta servers), so Meta receives the visitor’s IP address.',
      'Récupération des publications de notre page Facebook. Les images se chargent depuis l’adresse renvoyée par l’API Graph (serveurs de Meta), et Meta reçoit donc l’adresse IP du visiteur.',
      'Abruf von Beiträgen unserer Facebook-Seite. Bilder werden von der Adresse geladen, die die Graph API liefert (Meta-Server); Meta erhält dadurch die IP-Adresse des Besuchers.'),
    dataCategories: [L('IP adresa (pri načítaní obrázkov)', 'IP address (when loading images)', 'Adresse IP (au chargement des images)', 'IP-Adresse (beim Laden von Bildern)')],
    location: L(
      'Podľa Meta: USA, Írsko, Dánsko, Švédsko a ďalšie krajiny',
      'Per Meta: United States, Ireland, Denmark, Sweden and other countries',
      'Selon Meta : États-Unis, Irlande, Danemark, Suède et d’autres pays',
      'Laut Meta: USA, Irland, Dänemark, Schweden und weitere Länder'),
  }
}
export function hosting(o: { name: string; privacyUrl: string; location: ProcessorEntry['location'] }): ProcessorEntry {
  return {
    ...base, lastVerified: null, id: 'hosting',
    provider: { name: o.name, privacyUrl: o.privacyUrl },
    purpose: L('Prevádzka webovej stránky.', 'Running the website.', 'Hébergement du site web.', 'Betrieb der Website.'),
    dataCategories: [L('IP adresa', 'IP address', 'Adresse IP', 'IP-Adresse'), L('Serverové logy', 'Server logs', 'Journaux du serveur', 'Server-Logs')],
    location: o.location,
  }
}
