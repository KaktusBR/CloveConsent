import node from '@astrojs/node'
import { paraglideVitePlugin } from '@inlang/paraglide-js'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'
import { fileURLToPath } from 'node:url'

import { patchModule, replaceOnce } from './src/build/patch-module.ts'
import { THEME_SCRIPT } from './src/lib/theme.ts'
import { CSP_DIRECTIVES, cspHash } from './src/server/security.ts'

const sourcePath = (path) => JSON.stringify(fileURLToPath(new URL(path, import.meta.url)).replaceAll('\\', '/'))

// Both patches fail the build when they cannot apply (src/build/patch-module.ts): the adapter's code
// changed shape, or its module no longer goes through Vite.

/**
 * The built server loads the middleware (and so src/server/env.ts) only on the first request.
 * Import the env module at the top of the adapter's server entry instead, so an invalid
 * environment stops the process before it listens. Pinned by e2e/boot.spec.ts.
 * The auth module (Better Auth and its plugins) is loaded there too: evaluating it on the first request
 * blocked the event loop for about 2 s, so the first requests (and /readyz's 2 s probe) timed out.
 */
const validateEnvAtBoot = patchModule({
  name: 'cmp:validate-env-at-boot',
  module: '/@astrojs/node/dist/server.js',
  edit: (code) => `import ${sourcePath('./src/server/env.ts')};\nimport ${sourcePath('./src/server/auth/auth.ts')};\n${code}`,
})

/**
 * The adapter serves prerendered pages and bundled assets itself, before the app (and so the
 * middleware) runs. Its request handler sets every security header first, with a prerendered
 * page's hashed CSP from the adapter's `_headers.json` (`staticHeaders`), matched by exact path
 * (src/server/security.ts: staticSecurityHeaders, which also stops the server at boot when that
 * file is missing while there are prerendered pages). The adapter's own lookup is switched off: it
 * matches by substring, so `/sk/` missed the `/sk` page's policy. Pinned by e2e/security.spec.ts.
 */
const HAS_PRERENDERED_PAGES = 'app.manifest.routes.some((r) => r.routeData.prerender && r.routeData.type === "page")'
const securityHeadersOnFiles = patchModule({
  name: 'cmp:security-headers-on-files',
  module: '/@astrojs/node/dist/standalone.js',
  edit(code, fail) {
    let patched = replaceOnce(
      code,
      'const staticHandler = createStaticHandler(app, options, headersMap);',
      `const staticHandler = createStaticHandler(app, options, undefined);\n\tconst __cmpSecurity = __cmpStaticSecurityHeaders(headersMap, ${HAS_PRERENDERED_PAGES});`,
      fail,
    )
    patched = replaceOnce(patched, 'return (req, res) => {', 'return (req, res) => {\n\t\t__cmpSecurity(req, res);', fail)
    return `import { staticSecurityHeaders as __cmpStaticSecurityHeaders } from ${sourcePath('./src/server/security.ts')};\n${patched}`
  },
})

// No site/domain here: the public origin comes from PUBLIC_ORIGIN at runtime (src/server/env.ts).
//
// Languages: pages live under src/pages/[...locale]/, an optional first segment (none = English, `sk`), so
// one file answers /sign-in and /sk/sign-in, server-rendered or prerendered (getStaticPaths:
// localeStaticPaths). No Astro `i18n` block: with prefixDefaultLocale false it wants a copy of every page
// per language. The languages come from project.inlang/settings.json alone, so adding one is adding
// messages/<tag>.json and its tag there. The Paraglide plugin recompiles src/paraglide/ when a catalog
// changes in `astro dev` (options: project.inlang/paraglide.config.js).
//
// Security: a strict, hash-based CSP on every page (Astro hashes the scripts and styles it renders,
// and its client modules through an import map with integrity); the inline theme script is allowed by
// its hash. The other headers and the CSRF origin check: src/middleware.ts and src/server/security.ts.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone', staticHeaders: true }),
  integrations: [react()],
  security: {
    checkOrigin: true,
    csp: {
      algorithm: 'SHA-256',
      directives: [...CSP_DIRECTIVES],
      scriptDirective: { strictDynamic: true, hashes: [cspHash(THEME_SCRIPT)] },
    },
  },
  // No Markdown pages; Shiki's inline styles would need 'unsafe-inline' under the CSP.
  markdown: { syntaxHighlight: false },
  vite: { plugins: [tailwindcss(), validateEnvAtBoot, securityHeadersOnFiles, paraglideVitePlugin({ project: './project.inlang' })] },
})
