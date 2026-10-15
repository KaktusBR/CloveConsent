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

/** English is the source language of every banner text. Other languages arrive as language packs. */
export const en: Messages = {
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
}

export const MESSAGE_KEYS = Object.keys(en) as (keyof Messages)[]

export function format(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(vars, k) ? (vars[k] as string) : m))
}
