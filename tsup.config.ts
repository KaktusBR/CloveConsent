import { defineConfig } from 'tsup'
export default defineConfig({
  entry: { index: 'src/index.ts', catalog: 'src/catalog/index.ts', messages: 'src/messages.ts' },
  format: ['esm'], dts: true, clean: true, sourcemap: false, target: 'es2022', splitting: true,
})
