import type { LocalePack } from '../i18n/pack'

// Draft translation: not reviewed by a native speaker (reviewed: false).
const pack: LocalePack = {
  "locale": "de",
  "reviewed": false,
  "messages": {
    "bannerTitle": "Wir verwenden Cookies",
    "bannerText": "Unbedingt erforderliche Cookies setzen wir immer. Alle anderen nur mit Ihrer Einwilligung, die Sie jederzeit ändern können.",
    "acceptAll": "Alle akzeptieren",
    "rejectAll": "Ablehnen",
    "manage": "Einstellungen",
    "savePrefs": "Einstellungen speichern",
    "close": "Schließen",
    "prefsTitle": "Datenschutzeinstellungen",
    "prefsIntro": "Wählen Sie, welche Kategorien Sie zulassen.",
    "alwaysActive": "immer aktiv",
    "privacyLink": "Datenschutzerklärung",
    "reopen": "Cookie-Einstellungen",
    "tableName": "Name",
    "tableType": "Typ",
    "tableExpiry": "Laufzeit",
    "tablePurpose": "Zweck",
    "catNecessary": "Notwendig",
    "catNecessaryText": "Erforderlich für Sicherheit und Grundfunktionen der Seite. Sie können nicht deaktiviert werden.",
    "catFunctional": "Funktional",
    "catFunctionalText": "Merken sich Ihre eigenen Entscheidungen, zum Beispiel das Design der Seite.",
    "catMedia": "Medien",
    "catMediaText": "Eingebettete Videos und Karten von Dritten.",
    "catSocial": "Soziale Medien",
    "catSocialText": "Eingebettete Inhalte aus sozialen Netzwerken.",
    "catAnalytics": "Analyse",
    "catAnalyticsText": "Helfen uns zu verstehen, wie die Seite genutzt wird.",
    "catMarketing": "Marketing",
    "catMarketingText": "Dienen der Messung und Ausrichtung von Werbung.",
    "embedBlocked": "Inhalte von {provider} sind gesperrt, bis Sie sie zulassen.",
    "embedLoadOnce": "Einmal laden",
    "embedAllow": "{service} zulassen",
    "clearWarning": "Einige Dateien von Drittanbietern können von dieser Seite aus nicht entfernt werden. Löschen Sie sie in den Browsereinstellungen.",
    "receiptTitle": "Ihre Einwilligungsreferenz",
    "receiptNone": "Noch keine Auswahl gespeichert.",
    "receiptCopy": "Kopieren",
    "receiptCopied": "Kopiert",
    "receiptSaved": "Gespeichert",
    "receiptPolicy": "Version der Richtlinie",
    "receiptLanguage": "Sprache",
    "receiptChoice": "Auswahl",
    "choiceAll": "Alle",
    "choiceNecessary": "Nur notwendige",
    "choiceCustom": "Benutzerdefiniert",
    "settingsTitle": "Cookie- und Datenschutzeinstellungen",
    "settingsIntro": "Wählen Sie, was Sie zulassen. Notwendige Elemente sind immer aktiv. Sie können Ihre Auswahl jederzeit ändern oder widerrufen.",
    "settingsSaved": "Ihre Auswahl wurde gespeichert.",
    "withdraw": "Einwilligung widerrufen",
    "showDetails": "Details anzeigen",
    "hideDetails": "Details ausblenden",
    "servicesAllowed": "{allowed} von {total} zugelassen",
    "stateMixed": "Teilweise zugelassen",
    "noStorage": "Keine Speicherung dokumentiert",
    "processorsHeading": "Dienstleister",
    "processorLocation": "Standort",
    "processorData": "Datenkategorien",
    "processorDpa": "Auftragsverarbeitungsvertrag",
    "processorTransfers": "Übermittlungen"
  },
  "catalog": {
    "cloudflare-turnstile": {
      "title": "Cloudflare Turnstile",
      "description": "Schützt Formulare vor Bots."
    },
    "theme": {
      "title": "Seitendesign",
      "description": "Speichert Ihre Wahl des hellen oder dunklen Designs.",
      "storage": {
        "theme": {
          "expiry": "Dauerhaft (bis zum Löschen)",
          "purpose": "Merkt sich das helle oder dunkle Design."
        }
      }
    },
    "youtube": {
      "title": "YouTube-Videos",
      "description": "Eingebettete YouTube-Videos im erweiterten Datenschutzmodus (youtube-nocookie.com)."
    },
    "openstreetmap": {
      "title": "OpenStreetMap-Karten",
      "description": "Kartenbilder, die von OpenStreetMap-Servern geladen werden. Beim Laden werden Ihre IP-Adresse und die besuchte Website an OpenStreetMap übertragen."
    },
    "esri-imagery": {
      "title": "Esri-Satellitenbilder",
      "description": "Satellitenbilder, die von Esri-Servern geladen werden. Esri erhält beim Laden der Karte Ihre IP-Adresse."
    },
    "resend": {
      "purpose": "Versand von E-Mails aus Formularen.",
      "location": "USA (gespeicherte Daten). Die Versandregion (z. B. Irland) legt nur fest, von wo E-Mails versendet werden, nicht wo Daten gespeichert werden.",
      "transfers": "Übermittlung in die USA: Standardvertragsklauseln und EU-US-Datenschutzrahmen.",
      "dataCategories": [
        "E-Mail-Adresse",
        "Nachrichteninhalt",
        "E-Mail-Metadaten"
      ]
    },
    "cloudflare-cdn": {
      "purpose": "Auslieferung und Schutz der Seite (CDN, Angriffsschutz).",
      "location": "Globales Cloudflare-Netzwerk (Daten werden überwiegend in den USA und im EWR gespeichert)",
      "dataCategories": [
        "IP-Adresse",
        "Technische Anfragedaten"
      ]
    },
    "facebook-graph": {
      "purpose": "Abruf von Beiträgen unserer Facebook-Seite. Bilder werden von der Adresse geladen, die die Graph API liefert (Meta-Server); Meta erhält dadurch die IP-Adresse des Besuchers.",
      "location": "Laut Meta: USA, Irland, Dänemark, Schweden und weitere Länder",
      "dataCategories": [
        "IP-Adresse (beim Laden von Bildern)"
      ]
    },
    "hosting": {
      "purpose": "Betrieb der Website.",
      "dataCategories": [
        "IP-Adresse",
        "Server-Logs"
      ]
    }
  }
}

export default pack
