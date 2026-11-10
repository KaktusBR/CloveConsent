import { defineConfig } from 'vitest/config'
// css.include: without it Vitest turns every CSS import into an empty string, `?raw` (src/styles.ts) included
export default defineConfig({ test: { environment: 'jsdom', include: ['test/**/*.test.ts'], css: { include: [/\.css\?raw$/] } } })
