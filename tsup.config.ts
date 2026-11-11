import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { transform } from 'esbuild'
import { defineConfig, type Options } from 'tsup'

type Plugin = NonNullable<Options['esbuildPlugins']>[number]
const require = createRequire(import.meta.url)

/** `import text from './file.css?raw'` (src/styles.ts): the file's text as a string, as Vitest provides it. */
export const rawCss: Plugin = {
  name: 'raw-css',
  setup(build) {
    build.onResolve({ filter: /\.css\?raw$/ }, (args) => {
      const spec = args.path.slice(0, -'?raw'.length)
      const path = spec.startsWith('.') ? resolve(args.resolveDir, spec) : require.resolve(spec, { paths: [args.resolveDir] })
      // the suffix stays on the path: tsup's own stylesheet loader takes every path ending in .css, whatever its namespace
      return { path: `${path}?raw`, namespace: 'raw-css' }
    })
    const minify = !!build.initialOptions.minify
    build.onLoad({ filter: /\?raw$/, namespace: 'raw-css' }, async (args) => {
      const path = args.path.slice(0, -'?raw'.length)
      const css = await readFile(path, 'utf8')
      const contents = minify ? (await transform(css, { loader: 'css', minify: true })).code : css
      return { contents, loader: 'text', resolveDir: dirname(path) }
    })
  },
}

/**
 * The standalone runtime: one classic script (global `CloveConsent`, `boot` from src/standalone.ts) with the stylesheets inlined,
 * the runtime that `buildSiteScript` (src/site-script.ts) puts in front of each site's boot call. es2020 for older Safari.
 */
export const standaloneBuild: Options = {
  entry: { cloveconsent: 'src/standalone.ts' },
  outDir: 'dist/standalone', format: ['iife'], globalName: 'CloveConsent', platform: 'browser', target: 'es2020',
  minify: true, dts: false, clean: true, sourcemap: false, splitting: false,
  outExtension: () => ({ js: '.js' }), esbuildPlugins: [rawCss],
}

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts', catalog: 'src/catalog/index.ts',
      'locales/sk': 'src/locales/sk.ts', 'locales/fr': 'src/locales/fr.ts', 'locales/de': 'src/locales/de.ts',
      standalone: 'src/standalone.ts', 'site-script': 'src/site-script.ts',
    },
    // dist/standalone belongs to the build below, which runs at the same time
    format: ['esm'], dts: true, clean: ['!standalone/**'], sourcemap: false, target: 'es2022', splitting: true,
    // the engine's stylesheet is inlined as text, though the engine itself stays a dependency
    esbuildPlugins: [rawCss], noExternal: [/\.css\?raw$/],
  },
  standaloneBuild,
])
