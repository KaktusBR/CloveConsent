import { defineConfig } from 'drizzle-kit'

// `npm run db:generate` writes SQL migrations to drizzle/ from the schema; scripts/migrate.ts applies
// them as the owner role. drizzle-kit does not emit FORCE ROW LEVEL SECURITY or grants: add them by hand
// to the generated migration of each new table (see drizzle/0000_*.sql).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/data/schema/index.ts',
  out: './drizzle',
})
