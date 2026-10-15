import type { Locale } from './schema'

export interface Messages {
  bannerTitle: string; bannerText: string
  acceptAll: string; rejectAll: string; manage: string; savePrefs: string; close: string
  prefsTitle: string; prefsIntro: string; alwaysActive: string; privacyLink: string; reopen: string
  tableName: string; tableType: string; tableExpiry: string; tablePurpose: string
  catNecessary: string; catNecessaryText: string
  catFunctional: string; catFunctionalText: string
  catMedia: string; catMediaText: string
  catSocial: string; catSocialText: string
  catAnalytics: string; catAnalyticsText: string
  catMarketing: string; catMarketingText: string
  embedBlocked: string; embedLoadOnce: string; embedAccept: string
  clearWarning: string
  processorsHeading: string; processorLocation: string; processorData: string; processorDpa: string; processorTransfers: string
}

export const messages: Record<Locale, Messages> = {
  sk: {
    bannerTitle: 'Používame cookies', bannerText: 'Nevyhnutné súbory používame vždy. Ostatné len s vaším súhlasom, ktorý môžete kedykoľvek zmeniť.',
    acceptAll: 'Prijať všetky', rejectAll: 'Odmietnuť', manage: 'Nastavenia', savePrefs: 'Uložiť nastavenia', close: 'Zavrieť',
    prefsTitle: 'Nastavenia súkromia', prefsIntro: 'Tu si môžete vybrať, ktoré kategórie povolíte.', alwaysActive: 'vždy aktívne', privacyLink: 'Ochrana osobných údajov', reopen: 'Nastavenia cookies',
    tableName: 'Názov', tableType: 'Typ', tableExpiry: 'Platnosť', tablePurpose: 'Účel',
    catNecessary: 'Nevyhnutné', catNecessaryText: 'Potrebné na bezpečnosť a základné fungovanie stránky. Nemožno ich vypnúť.',
    catFunctional: 'Funkčné', catFunctionalText: 'Zapamätajú si vaše vlastné voľby, napríklad vzhľad stránky.',
    catMedia: 'Médiá', catMediaText: 'Vložené videá a mapy od tretích strán.',
    catSocial: 'Sociálne siete', catSocialText: 'Vložený obsah zo sociálnych sietí.',
    catAnalytics: 'Analytické', catAnalyticsText: 'Pomáhajú pochopiť, ako sa stránka používa.',
    catMarketing: 'Marketingové', catMarketingText: 'Používajú sa na meranie a zacielenie reklamy.',
    embedBlocked: 'Obsah poskytovateľa {provider} je zablokovaný, kým ho nepovolíte.', embedLoadOnce: 'Načítať raz', embedAccept: 'Povoliť kategóriu',
    clearWarning: 'Niektoré súbory od tretích strán nemožno z tejto stránky odstrániť. Zmažte ich v nastaveniach prehliadača.',
    processorsHeading: 'Poskytovatelia služieb', processorLocation: 'Umiestnenie', processorData: 'Kategórie údajov', processorDpa: 'Zmluva o spracovaní', processorTransfers: 'Prenosy',
  },
  en: {
    bannerTitle: 'We use cookies', bannerText: 'We always use the strictly necessary ones. Everything else only with your consent, which you can change at any time.',
    acceptAll: 'Accept all', rejectAll: 'Reject', manage: 'Settings', savePrefs: 'Save settings', close: 'Close',
    prefsTitle: 'Privacy settings', prefsIntro: 'Choose which categories you allow.', alwaysActive: 'always active', privacyLink: 'Privacy policy', reopen: 'Cookie settings',
    tableName: 'Name', tableType: 'Type', tableExpiry: 'Expiry', tablePurpose: 'Purpose',
    catNecessary: 'Necessary', catNecessaryText: 'Needed for security and basic site operation. They cannot be turned off.',
    catFunctional: 'Functional', catFunctionalText: 'Remember your own choices, for example the site theme.',
    catMedia: 'Media', catMediaText: 'Embedded videos and maps from third parties.',
    catSocial: 'Social', catSocialText: 'Embedded content from social networks.',
    catAnalytics: 'Analytics', catAnalyticsText: 'Help us understand how the site is used.',
    catMarketing: 'Marketing', catMarketingText: 'Used to measure and target advertising.',
    embedBlocked: 'Content from {provider} is blocked until you allow it.', embedLoadOnce: 'Load once', embedAccept: 'Allow category',
    clearWarning: 'Some third-party files cannot be removed from this site. Delete them in your browser settings.',
    processorsHeading: 'Service providers', processorLocation: 'Location', processorData: 'Data categories', processorDpa: 'Data processing agreement', processorTransfers: 'Transfers',
  },
  fr: {
    bannerTitle: 'Nous utilisons des cookies', bannerText: 'Nous utilisons toujours les cookies strictement nécessaires. Les autres uniquement avec votre accord, modifiable à tout moment.',
    acceptAll: 'Tout accepter', rejectAll: 'Refuser', manage: 'Paramètres', savePrefs: 'Enregistrer', close: 'Fermer',
    prefsTitle: 'Paramètres de confidentialité', prefsIntro: 'Choisissez les catégories que vous autorisez.', alwaysActive: 'toujours actif', privacyLink: 'Politique de confidentialité', reopen: 'Paramètres des cookies',
    tableName: 'Nom', tableType: 'Type', tableExpiry: 'Durée', tablePurpose: 'Finalité',
    catNecessary: 'Nécessaires', catNecessaryText: 'Indispensables à la sécurité et au fonctionnement de base du site. Ils ne peuvent pas être désactivés.',
    catFunctional: 'Fonctionnels', catFunctionalText: 'Mémorisent vos propres choix, par exemple le thème du site.',
    catMedia: 'Médias', catMediaText: 'Vidéos et cartes intégrées de tiers.',
    catSocial: 'Réseaux sociaux', catSocialText: 'Contenu intégré provenant de réseaux sociaux.',
    catAnalytics: 'Statistiques', catAnalyticsText: 'Nous aident à comprendre l’utilisation du site.',
    catMarketing: 'Marketing', catMarketingText: 'Servent à mesurer et cibler la publicité.',
    embedBlocked: 'Le contenu de {provider} est bloqué tant que vous ne l’autorisez pas.', embedLoadOnce: 'Charger une fois', embedAccept: 'Autoriser la catégorie',
    clearWarning: 'Certains fichiers de tiers ne peuvent pas être supprimés depuis ce site. Supprimez-les dans les paramètres de votre navigateur.',
    processorsHeading: 'Prestataires de services', processorLocation: 'Localisation', processorData: 'Catégories de données', processorDpa: 'Accord de traitement des données', processorTransfers: 'Transferts',
  },
  de: {
    bannerTitle: 'Wir verwenden Cookies', bannerText: 'Unbedingt erforderliche Cookies setzen wir immer. Alle anderen nur mit Ihrer Einwilligung, die Sie jederzeit ändern können.',
    acceptAll: 'Alle akzeptieren', rejectAll: 'Ablehnen', manage: 'Einstellungen', savePrefs: 'Einstellungen speichern', close: 'Schließen',
    prefsTitle: 'Datenschutzeinstellungen', prefsIntro: 'Wählen Sie, welche Kategorien Sie zulassen.', alwaysActive: 'immer aktiv', privacyLink: 'Datenschutzerklärung', reopen: 'Cookie-Einstellungen',
    tableName: 'Name', tableType: 'Typ', tableExpiry: 'Laufzeit', tablePurpose: 'Zweck',
    catNecessary: 'Notwendig', catNecessaryText: 'Erforderlich für Sicherheit und Grundfunktionen der Seite. Sie können nicht deaktiviert werden.',
    catFunctional: 'Funktional', catFunctionalText: 'Merken sich Ihre eigenen Entscheidungen, zum Beispiel das Design der Seite.',
    catMedia: 'Medien', catMediaText: 'Eingebettete Videos und Karten von Dritten.',
    catSocial: 'Soziale Medien', catSocialText: 'Eingebettete Inhalte aus sozialen Netzwerken.',
    catAnalytics: 'Analyse', catAnalyticsText: 'Helfen uns zu verstehen, wie die Seite genutzt wird.',
    catMarketing: 'Marketing', catMarketingText: 'Dienen der Messung und Ausrichtung von Werbung.',
    embedBlocked: 'Inhalte von {provider} sind gesperrt, bis Sie sie zulassen.', embedLoadOnce: 'Einmal laden', embedAccept: 'Kategorie zulassen',
    clearWarning: 'Einige Dateien von Drittanbietern können von dieser Seite aus nicht entfernt werden. Löschen Sie sie in den Browsereinstellungen.',
    processorsHeading: 'Dienstleister', processorLocation: 'Standort', processorData: 'Datenkategorien', processorDpa: 'Auftragsverarbeitungsvertrag', processorTransfers: 'Übermittlungen',
  },
}

export const unreviewedMessageLocales: Locale[] = ['fr', 'de']

export function format(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(vars, k) ? (vars[k] as string) : m))
}
