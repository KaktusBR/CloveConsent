import js from '@eslint/js'
import astro from 'eslint-plugin-astro'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

import dataLayerOnly from './eslint-rules/data-layer-only.js'

export default defineConfig(
  { ignores: ['dist/', '.astro/', 'node_modules/', 'test-results/', 'playwright-report/', 'src/paraglide/'] },
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
    // Tenant isolation: only src/server/data/ talks to the database (the rule exempts that folder itself).
    files: ['src/**/*.{ts,tsx,astro,js,mjs}'],
    plugins: { cmp: { rules: { 'data-layer-only': dataLayerOnly } } },
    rules: { 'cmp/data-layer-only': 'error' },
  },
)
