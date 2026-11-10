// Bundles the test harness (Ruling R2) to a classic script the fixture pages load first in <head>.
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

export default async function globalSetup(): Promise<void> {
  await build({
    entryPoints: [fileURLToPath(new URL('./fixtures/harness.ts', import.meta.url))],
    outfile: fileURLToPath(new URL('./.out/harness.js', import.meta.url)),
    bundle: true, format: 'iife', target: 'es2022', platform: 'browser', logLevel: 'warning',
  })
}
