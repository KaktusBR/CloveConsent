import type { LocalePack } from '../i18n/pack'

// Draft translation: not reviewed by a native speaker (reviewed: false).
const pack: LocalePack = {
  "locale": "fr",
  "reviewed": false,
  "messages": {
    "bannerTitle": "Nous utilisons des cookies",
    "bannerText": "Nous utilisons toujours les cookies strictement nécessaires. Les autres uniquement avec votre accord, modifiable à tout moment.",
    "acceptAll": "Tout accepter",
    "rejectAll": "Refuser",
    "manage": "Paramètres",
    "savePrefs": "Enregistrer",
    "close": "Fermer",
    "prefsTitle": "Paramètres de confidentialité",
    "prefsIntro": "Choisissez les catégories que vous autorisez.",
    "alwaysActive": "toujours actif",
    "privacyLink": "Politique de confidentialité",
    "reopen": "Paramètres des cookies",
    "tableName": "Nom",
    "tableType": "Type",
    "tableExpiry": "Durée",
    "tablePurpose": "Finalité",
    "catNecessary": "Nécessaires",
    "catNecessaryText": "Indispensables à la sécurité et au fonctionnement de base du site. Ils ne peuvent pas être désactivés.",
    "catFunctional": "Fonctionnels",
    "catFunctionalText": "Mémorisent vos propres choix, par exemple le thème du site.",
    "catMedia": "Médias",
    "catMediaText": "Vidéos et cartes intégrées de tiers.",
    "catSocial": "Réseaux sociaux",
    "catSocialText": "Contenu intégré provenant de réseaux sociaux.",
    "catAnalytics": "Statistiques",
    "catAnalyticsText": "Nous aident à comprendre l’utilisation du site.",
    "catMarketing": "Marketing",
    "catMarketingText": "Servent à mesurer et cibler la publicité.",
    "embedBlocked": "Votre choix de cookies a désactivé {service}.",
    "embedHint": "Activez les cookies de la catégorie {category} pour l’afficher.",
    "embedLoadOnce": "Charger une fois",
    "embedAllow": "Autoriser {service}",
    "embedUnavailable": "Ce contenu n’est pas disponible sur ce site.",
    "clearWarning": "Certains fichiers de tiers ne peuvent pas être supprimés depuis ce site. Supprimez-les dans les paramètres de votre navigateur.",
    "receiptTitle": "Votre référence de consentement",
    "receiptNone": "Aucun choix enregistré pour le moment.",
    "receiptCopy": "Copier",
    "receiptCopied": "Copié",
    "receiptSaved": "Enregistré",
    "receiptPolicy": "Version de la politique",
    "receiptLanguage": "Langue",
    "receiptChoice": "Choix",
    "choiceAll": "Tout",
    "choiceNecessary": "Nécessaires uniquement",
    "choiceCustom": "Personnalisé",
    "settingsTitle": "Paramètres des cookies et de confidentialité",
    "settingsIntro": "Choisissez ce que vous autorisez. Les éléments nécessaires sont toujours activés. Vous pouvez modifier ou retirer votre choix à tout moment.",
    "settingsSaved": "Votre choix a été enregistré.",
    "withdraw": "Retirer le consentement",
    "showDetails": "Afficher les détails",
    "hideDetails": "Masquer les détails",
    "servicesAllowed": "{allowed} sur {total} autorisés",
    "stateMixed": "Partiellement autorisé",
    "noStorage": "Aucun stockage documenté",
    "processorsHeading": "Prestataires de services",
    "processorLocation": "Localisation",
    "processorData": "Catégories de données",
    "processorDpa": "Accord de traitement des données",
    "processorTransfers": "Transferts"
  },
  "catalog": {
    "cloudflare-turnstile": {
      "title": "Cloudflare Turnstile",
      "description": "Protège les formulaires contre les robots."
    },
    "theme": {
      "title": "Thème du site",
      "description": "Enregistre votre choix de thème clair ou sombre.",
      "storage": {
        "theme": {
          "expiry": "Permanent (jusqu’à suppression)",
          "purpose": "Mémorise l’apparence claire ou sombre."
        }
      }
    },
    "youtube": {
      "title": "Vidéos YouTube",
      "description": "Vidéos YouTube intégrées en mode de confidentialité renforcée (youtube-nocookie.com)."
    },
    "openstreetmap": {
      "title": "Cartes OpenStreetMap",
      "description": "Images de carte chargées depuis les serveurs d’OpenStreetMap. Leur chargement transmet à OpenStreetMap votre adresse IP et le site sur lequel vous vous trouvez."
    },
    "esri-imagery": {
      "title": "Imagerie satellite Esri",
      "description": "Images satellites chargées depuis les serveurs d’Esri. Esri reçoit votre adresse IP lors du chargement de la carte."
    },
    "google-analytics": {
      "title": "Google Analytics",
      "description": "Mesure l’utilisation du site (pages vues, durée de visite). Les données sont envoyées à Google.",
      "storage": {
        "_ga": {
          "expiry": "2 ans",
          "purpose": "Distingue les visiteurs pour mesurer l’utilisation du site."
        },
        "_ga_container": {
          "expiry": "2 ans",
          "purpose": "Conserve l’état de la session pour cette propriété Google Analytics."
        }
      }
    },
    "google-tag-manager": {
      "title": "Google Tag Manager",
      "description": "Charge les balises du site (par exemple d’analyse ou de publicité) depuis Google Tag Manager."
    },
    "meta-pixel": {
      "title": "Pixel Meta",
      "description": "Mesure et cible la publicité sur Facebook et Instagram. Les données de visite sont envoyées à Meta.",
      "storage": {
        "_fbp": {
          "expiry": "90 jours",
          "purpose": "Identifie le navigateur afin que Meta puisse mesurer et cibler la publicité."
        }
      }
    },
    "resend": {
      "purpose": "Envoi d’e-mails depuis les formulaires.",
      "location": "États-Unis (données stockées). La région d’envoi (par exemple l’Irlande) détermine seulement d’où les e-mails sont envoyés, pas où les données sont stockées.",
      "transfers": "Transferts vers les États-Unis : clauses contractuelles types et cadre de protection des données UE-États-Unis.",
      "dataCategories": [
        "Adresse e-mail",
        "Contenu du message",
        "Métadonnées de l’e-mail"
      ]
    },
    "cloudflare-cdn": {
      "purpose": "Diffusion et protection du site (CDN, protection contre les attaques).",
      "location": "Réseau mondial de Cloudflare (données stockées principalement aux États-Unis et dans l’EEE)",
      "dataCategories": [
        "Adresse IP",
        "Données techniques de la requête"
      ]
    },
    "facebook-graph": {
      "purpose": "Récupération des publications de notre page Facebook. Les images se chargent depuis l’adresse renvoyée par l’API Graph (serveurs de Meta), et Meta reçoit donc l’adresse IP du visiteur.",
      "location": "Selon Meta : États-Unis, Irlande, Danemark, Suède et d’autres pays",
      "dataCategories": [
        "Adresse IP (au chargement des images)"
      ]
    },
    "hosting": {
      "purpose": "Hébergement du site web.",
      "dataCategories": [
        "Adresse IP",
        "Journaux du serveur"
      ]
    }
  }
}

export default pack
