import node from '@astrojs/node'
import { paraglideVitePlugin } from '@inlang/paraglide-js'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'
import { fileURLToPath } from 'node:url'

const envModule = fileURLToPath(new URL('./src/server/env.ts', import.meta.url)).replaceAll('\\', '/')

/**
 * The built server loads the middleware (and so src/server/env.ts) only on the first request.
 * Import the env module at the top of the adapter's server entry instead, so an invalid
 * environment stops the process before it listens. Pinned by e2e/boot.spec.ts.
 */
const validateEnvAtBoot = {
  name: 'cmp:validate-env-at-boot',
  apply: 'build',
  transform(code, id) {
    if (!id.replaceAll('\\', '/').endsWith('/@astrojs/node/dist/server.js')) return null
    return { code: `import ${JSON.stringify(envModule)};\n${code}`, map: null }
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
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  vite: { plugins: [tailwindcss(), validateEnvAtBoot, paraglideVitePlugin({ project: './project.inlang' })] },
})
