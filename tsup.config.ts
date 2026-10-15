import { defineConfig } from 'tsup'
export default defineConfig({
  entry: {
    index: 'src/index.ts', catalog: 'src/catalog/index.ts',
    'locales/sk': 'src/locales/sk.ts', 'locales/fr': 'src/locales/fr.ts', 'locales/de': 'src/locales/de.ts',
  },
  format: ['esm'], dts: true, clean: true, sourcemap: false, target: 'es2022', splitting: true,
})
