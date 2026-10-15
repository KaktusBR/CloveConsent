import { defineConfig } from 'astro/config'
import { fileURLToPath } from 'node:url'
const r = (p) => fileURLToPath(new URL(p, import.meta.url))
export default defineConfig({
  vite: { resolve: { alias: [
    { find: 'cloveconsent/catalog', replacement: r('../../src/catalog/index.ts') },
    { find: 'cloveconsent/locales', replacement: r('../../src/locales') },
    { find: 'cloveconsent', replacement: r('../../src/index.ts') },
  ] } },
})
