import type { LocalePack } from '../i18n/pack'

// Draft translation: not reviewed by a native speaker (reviewed: false).
const pack: LocalePack = {
  "locale": "sk",
  "reviewed": false,
  "messages": {
    "bannerTitle": "Používame cookies",
    "bannerText": "Nevyhnutné súbory používame vždy. Ostatné len s vaším súhlasom, ktorý môžete kedykoľvek zmeniť.",
    "acceptAll": "Prijať všetky",
    "rejectAll": "Odmietnuť",
    "manage": "Nastavenia",
    "savePrefs": "Uložiť nastavenia",
    "close": "Zavrieť",
    "prefsTitle": "Nastavenia súkromia",
    "prefsIntro": "Tu si môžete vybrať, ktoré kategórie povolíte.",
    "alwaysActive": "vždy aktívne",
    "privacyLink": "Ochrana osobných údajov",
    "reopen": "Nastavenia cookies",
    "tableName": "Názov",
    "tableType": "Typ",
    "tableExpiry": "Platnosť",
    "tablePurpose": "Účel",
    "catNecessary": "Nevyhnutné",
    "catNecessaryText": "Potrebné na bezpečnosť a základné fungovanie stránky. Nemožno ich vypnúť.",
    "catFunctional": "Funkčné",
    "catFunctionalText": "Zapamätajú si vaše vlastné voľby, napríklad vzhľad stránky.",
    "catMedia": "Médiá",
    "catMediaText": "Vložené videá a mapy od tretích strán.",
    "catSocial": "Sociálne siete",
    "catSocialText": "Vložený obsah zo sociálnych sietí.",
    "catAnalytics": "Analytické",
    "catAnalyticsText": "Pomáhajú pochopiť, ako sa stránka používa.",
    "catMarketing": "Marketingové",
    "catMarketingText": "Používajú sa na meranie a zacielenie reklamy.",
    "embedBlocked": "Obsah poskytovateľa {provider} je zablokovaný, kým ho nepovolíte.",
    "embedLoadOnce": "Načítať raz",
    "embedAccept": "Povoliť kategóriu",
    "clearWarning": "Niektoré súbory od tretích strán nemožno z tejto stránky odstrániť. Zmažte ich v nastaveniach prehliadača.",
    "processorsHeading": "Poskytovatelia služieb",
    "processorLocation": "Umiestnenie",
    "processorData": "Kategórie údajov",
    "processorDpa": "Zmluva o spracovaní",
    "processorTransfers": "Prenosy"
  },
  "catalog": {
    "cloudflare-turnstile": {
      "title": "Cloudflare Turnstile",
      "description": "Ochrana formulárov pred robotmi."
    },
    "theme": {
      "title": "Vzhľad stránky",
      "description": "Uloží vašu voľbu svetlého alebo tmavého vzhľadu.",
      "storage": {
        "theme": {
          "expiry": "Trvalo (kým ho nezmažete)",
          "purpose": "Pamätá si svetlý alebo tmavý vzhľad."
        }
      }
    },
    "youtube": {
      "title": "Videá YouTube",
      "description": "Vložené videá z YouTube v rozšírenom režime ochrany súkromia (youtube-nocookie.com)."
    },
    "openstreetmap": {
      "title": "Mapy OpenStreetMap",
      "description": "Mapové podklady načítané zo serverov OpenStreetMap. Pri ich načítaní sa OpenStreetMap odošle vaša IP adresa a webová stránka, na ktorej sa nachádzate."
    },
    "esri-imagery": {
      "title": "Satelitné snímky Esri",
      "description": "Satelitné mapové podklady načítané zo serverov Esri. Pri načítaní mapy dostane Esri vašu IP adresu."
    },
    "resend": {
      "purpose": "Odosielanie e-mailov z formulárov.",
      "location": "USA (uložené údaje). Región odosielania (napr. Írsko) určuje len to, odkiaľ sa e-maily odosielajú, nie kde sa údaje ukladajú.",
      "transfers": "Prenos do USA: štandardné zmluvné doložky a rámec ochrany údajov EÚ–USA.",
      "dataCategories": [
        "E-mailová adresa",
        "Obsah správy",
        "Metadáta e-mailu"
      ]
    },
    "cloudflare-cdn": {
      "purpose": "Doručovanie a ochrana stránky (CDN, ochrana pred útokmi).",
      "location": "Globálna sieť Cloudflare (údaje sa ukladajú primárne v USA a EHP)",
      "dataCategories": [
        "IP adresa",
        "Technické údaje o požiadavke"
      ]
    },
    "facebook-graph": {
      "purpose": "Načítanie príspevkov zo stránky na Facebooku. Obrázky príspevkov sa načítavajú z adresy, ktorú vráti Graph API (servery Meta), a Meta tak dostane IP adresu návštevníka.",
      "location": "Podľa Meta: USA, Írsko, Dánsko, Švédsko a ďalšie krajiny",
      "dataCategories": [
        "IP adresa (pri načítaní obrázkov)"
      ]
    },
    "hosting": {
      "purpose": "Prevádzka webovej stránky.",
      "dataCategories": [
        "IP adresa",
        "Serverové logy"
      ]
    }
  }
}

export default pack
