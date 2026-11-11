// Bundles the test harness (Ruling R2) to a classic script the fixture pages load first in <head>, and writes the real site
// script (buildSiteScript over dist/standalone, built by `npm run test:browser`) for the site fixture.
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { siteScript } from './fixtures/site'

export default async function globalSetup(): Promise<void> {
  await build({
    entryPoints: [fileURLToPath(new URL('./fixtures/harness.ts', import.meta.url))],
    outfile: fileURLToPath(new URL('./.out/harness.js', import.meta.url)),
    bundle: true, format: 'iife', target: 'es2022', platform: 'browser', logLevel: 'warning',
  })
  await mkdir(new URL('./.out/', import.meta.url), { recursive: true })
  await writeFile(new URL('./.out/site.js', import.meta.url), await siteScript())
}
