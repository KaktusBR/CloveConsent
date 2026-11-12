// Paraglide compiler options, shared by the CLI (`npm run i18n`) and the Vite plugin (astro.config.mjs).
// Paths are relative to cmp/.
//
// Locale on the server: src/middleware.ts resolves it per request (src/i18n/locale.ts) and runs the
// request inside Paraglide's AsyncLocalStorage, so `getLocale()` and every `m.*()` see it.
// Locale in the browser: the URL (`/sk/...` is Slovak, unprefixed is English), the same rule the
// server uses to render the page, so islands hydrate in the page's language.
export default {
  outdir: './src/paraglide',
  strategy: ['url', 'baseLocale'],
  outputStructure: 'message-modules',
  emitTsDeclarations: true,
  emitReadme: false,
  emitPrettierIgnore: false,
}
