import js from '@eslint/js'
import astro from 'eslint-plugin-astro'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

/**
 * Tenant isolation: only src/server/data/ may talk to the database directly.
 * Everything else goes through the data layer's scoped API.
 */
const DB_CLIENT_RESTRICTION = {
  paths: [
    { name: 'pg', message: 'Only src/server/data/ talks to the database; use its scoped API.' },
    { name: 'postgres', message: 'Only src/server/data/ talks to the database; use its scoped API.' },
  ],
  patterns: [
    { group: ['drizzle-orm/node-postgres', 'drizzle-orm/node-postgres/*', 'drizzle-orm/postgres-js', 'drizzle-orm/postgres-js/*'], message: 'Only src/server/data/ creates database clients.' },
    { group: ['**/server/data/client', '**/server/data/client.*', '@/server/data/client', '@/server/data/client.*'], message: 'The database client is private to src/server/data/; use its scoped API.' },
  ],
}

export default defineConfig(
  { ignores: ['dist/', '.astro/', 'node_modules/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  astro.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['src/**/*.{ts,tsx,astro}'],
    ignores: ['src/server/data/**'],
    rules: { 'no-restricted-imports': ['error', DB_CLIENT_RESTRICTION] },
  },
)
