import { defineConsent } from 'cloveconsent'
import sk from 'cloveconsent/locales/sk'
import { cloudflareCdn, theme, turnstile, youtube } from 'cloveconsent/catalog'
export default defineConsent({
  locales: ['sk', 'en'], defaultLocale: 'sk', revision: 1, packs: [sk], privacyHref: '/ochrana-udajov/',
  services: [turnstile(), theme(), youtube()],
  processors: [cloudflareCdn()],
})
