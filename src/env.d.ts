// Minimal shape of the bundler-provided import.meta.env read by src/dev.ts. Kept out of the public
// declarations (not imported by any entry) so it cannot clash with a consumer's vite/client types.
interface ImportMeta { readonly env?: { readonly DEV?: unknown } }
