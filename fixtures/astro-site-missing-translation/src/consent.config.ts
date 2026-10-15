import { defineConsent } from 'cloveconsent'
import { cloudflareCdn, theme, turnstile, youtube } from 'cloveconsent/catalog'
export default defineConsent({
  locales: ['pl'], defaultLocale: 'pl', revision: 1, privacyHref: '/ochrana-udajov/',
  services: [turnstile(), theme(), youtube()],
  processors: [cloudflareCdn()],
})
