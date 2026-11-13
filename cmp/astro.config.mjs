import node from '@astrojs/node'
import { paraglideVitePlugin } from '@inlang/paraglide-js'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'
import { fileURLToPath } from 'node:url'

import { THEME_SCRIPT } from './src/lib/theme.ts'
import { CSP_DIRECTIVES, cspHash } from './src/server/security.ts'

const sourcePath = (path) => fileURLToPath(new URL(path, import.meta.url)).replaceAll('\\', '/')
const envModule = sourcePath('./src/server/env.ts')
const securityModule = sourcePath('./src/server/security.ts')
const isModule = (id, suffix) => id.replaceAll('\\', '/').endsWith(suffix)

/**
 * The built server loads the middleware (and so src/server/env.ts) only on the first request.
 * Import the env module at the top of the adapter's server entry instead, so an invalid
 * environment stops the process before it listens. Pinned by e2e/boot.spec.ts.
 */
const validateEnvAtBoot = {
  name: 'cmp:validate-env-at-boot',
  apply: 'build',
  transform(code, id) {
    if (!isModule(id, '/@astrojs/node/dist/server.js')) return null
    return { code: `import ${JSON.stringify(envModule)};\n${code}`, map: null }
  },
}

/**
 * The adapter serves prerendered pages and bundled assets itself, before the app (and so the
 * middleware) runs. Its request handler sets every security header first, with a prerendered
 * page's hashed CSP from the adapter's `_headers.json` (`staticHeaders`), matched by exact path
 * (src/server/security.ts: staticSecurityHeaders). The adapter's own lookup is switched off: it
 * matches by substring, so `/sk/` missed the `/sk` page's policy. The build fails if the adapter's
 * code no longer has the expected shape, rather than serving files without the headers.
 * Pinned by e2e/security.spec.ts.
 */
const STATIC_HANDLER = 'const staticHandler = createStaticHandler(app, options, headersMap);'
const REQUEST_HANDLER = 'return (req, res) => {'
const securityHeadersOnFiles = {
  name: 'cmp:security-headers-on-files',
  apply: 'build',
  transform(code, id) {
    if (!isModule(id, '/@astrojs/node/dist/standalone.js')) return null
    for (const anchor of [STATIC_HANDLER, REQUEST_HANDLER]) {
      if (code.split(anchor).length !== 2) this.error(`"${anchor}" not found once in ${id}: security headers cannot be added`)
    }
    const patched = code
      .replace(STATIC_HANDLER, 'const staticHandler = createStaticHandler(app, options, undefined);\n\tconst __cmpSecurity = __cmpStaticSecurityHeaders(headersMap);')
      .replace(REQUEST_HANDLER, `${REQUEST_HANDLER}\n\t\t__cmpSecurity(req, res);`)
    return { code: `import { staticSecurityHeaders as __cmpStaticSecurityHeaders } from ${JSON.stringify(securityModule)};\n${patched}`, map: null }
  },
}

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
