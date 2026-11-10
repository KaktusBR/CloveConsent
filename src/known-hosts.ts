/**
 * Hosts of known tracking and embedding services -> the catalog id that covers them. Auto-blocking uses this map for a tracker
 * the site's configuration does not list: the element stays blocked (no configured service can allow it) and is reported as
 * unconfigured. Hosts are lowercase plain hostnames, matched exactly.
 *
 * Sources:
 * - "catalog": the `origins` of a shipped catalog entry (src/catalog/*.ts); as verified as that entry is.
 * - "unverified": common hosts of services the catalog will cover, from memory, not checked against vendor documentation;
 *   their ids name catalog entries that do not exist yet.
 */
export const KNOWN_HOSTS: Readonly<Record<string, string>> = Object.freeze({
  // catalog. Google Analytics loads from the same host; a configured Google Analytics takes it through the site's configuration
  'www.googletagmanager.com': 'google-tag-manager',
  'connect.facebook.net': 'meta-pixel', // catalog
  'www.youtube-nocookie.com': 'youtube', // catalog
  'server.arcgisonline.com': 'esri-imagery', // catalog
  'tile.openstreetmap.org': 'openstreetmap', // catalog
  'challenges.cloudflare.com': 'cloudflare-turnstile', // catalog

  // unverified
  'www.google-analytics.com': 'google-analytics',
  'region1.google-analytics.com': 'google-analytics',
  'ssl.google-analytics.com': 'google-analytics',
  'www.youtube.com': 'youtube',
  'youtube.com': 'youtube',
  'www.facebook.com': 'meta-pixel',
  'googleads.g.doubleclick.net': 'google-ads',
  'www.googleadservices.com': 'google-ads',
  'static.hotjar.com': 'hotjar',
  'script.hotjar.com': 'hotjar',
  'www.clarity.ms': 'microsoft-clarity',
  'snap.licdn.com': 'linkedin-insight',
  'analytics.tiktok.com': 'tiktok-pixel',
  'player.vimeo.com': 'vimeo',
})
