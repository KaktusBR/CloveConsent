/**
 * Prints the app's route manifest, as Astro resolves it: the routes of src/pages and the routes Astro and
 * the integrations inject (`/_image`, `/_server-islands/[name]`, …). It runs `astro sync` with an
 * integration on the `astro:routes:resolved` hook, so no build is needed.
 *
 *   node scripts/route-manifest.ts   →  one line: ROUTES <json>
 *
 * Other output (integrations log during sync) goes before that line. test/routes.ts reads it, so the
 * route sweeps (access rules, tenant isolation) cover every route the server answers.
 */
import { sync } from 'astro'

const MARKER = 'ROUTES '

interface ManifestRoute {
  pattern: string
  type: string
  origin: string
  entrypoint: string
  isPrerendered: boolean
}

let routes: ManifestRoute[] = []
await sync({
  root: process.cwd(),
  logLevel: 'error',
  integrations: [
    {
      name: 'route-manifest',
      hooks: {
        'astro:routes:resolved': ({ routes: resolved }) => {
          routes = resolved.map((r) => ({ pattern: r.pattern, type: r.type, origin: r.origin, entrypoint: r.entrypoint, isPrerendered: r.isPrerendered }))
        },
      },
    },
  ],
})
if (routes.length === 0) {
  console.error('route-manifest: Astro resolved no routes')
  process.exit(1)
}
console.log(`${MARKER}${JSON.stringify(routes)}`)
