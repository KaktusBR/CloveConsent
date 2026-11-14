import { ESLint } from 'eslint'
import { describe, expect, test } from 'vitest'

const eslint = new ESLint({ cwd: process.cwd() })
const RULE = 'cmp/data-layer-only'

async function restricted(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: file })
  return (result?.messages ?? []).filter((m) => m.ruleId === RULE).map((m) => m.message)
}

describe('database client import rule', () => {
  test.each([
    ["import pg from 'pg'", 'src/pages/x.ts'],
    ["import { Client } from 'pg/lib/client'", 'src/pages/x.ts'],
    ["import postgres from 'postgres'", 'src/server/auth/x.ts'],
    ["import { drizzle } from 'drizzle-orm/node-postgres'", 'src/server/jobs/x.ts'],
    ["import { drizzle } from 'drizzle-orm/postgres-js'", 'src/server/jobs/x.ts'],
    ["import { db } from '../server/data/client'", 'src/pages/x.ts'],
    ["import { db } from '../data/client'", 'src/server/auth/x.ts'],
    ["import { db } from './data/client'", 'src/server/x.ts'],
    ["import { db } from './data/client.ts'", 'src/server/x.ts'],
    ["import { db } from './data/client/index'", 'src/server/x.ts'],
    ["import { db } from '@/server/data/client'", 'src/components/x.tsx'],
    ["export { db } from './data/client'", 'src/server/x.ts'],
    ["export * from '../data/client'", 'src/server/auth/x.ts'],
    ["const pg = await import('pg')", 'src/pages/x.ts'],
    ["const c = await import('../data/client')", 'src/server/auth/x.ts'],
    ["const m = 'pg'; const pg = await import(m)", 'src/pages/x.ts'],
    ["const pg = require('pg')", 'src/pages/x.ts'],
    ["import Pool from 'pg-pool'", 'src/pages/x.ts'],
    ["import { GuardedPool } from '../server/data/pool'", 'src/pages/x.ts'],
    ["import Native from 'pg-native'", 'src/server/x.ts'],
    ["import { neon } from '@neondatabase/serverless'", 'src/pages/x.ts'],
    ["import { drizzle } from 'drizzle-orm/neon-http'", 'src/server/x.ts'],
    ["import { drizzle } from 'drizzle-orm/pglite'", 'src/server/x.ts'],
    ["import { drizzle } from 'drizzle-orm/pg-proxy'", 'src/server/x.ts'],
    ["import { drizzle } from 'drizzle-orm/vercel-postgres'", 'src/server/x.ts'],
    ["import { drizzle } from 'drizzle-orm/aws-data-api/pg'", 'src/server/x.ts'],
    ["import { migrate } from 'drizzle-orm/node-postgres/migrator'", 'src/server/x.ts'],
    ["import { drizzle } from 'drizzle-orm/some-future-driver'", 'src/server/x.ts'],
    ["import { PgBoss } from 'pg-boss'", 'src/server/jobs/x.ts'],
    ["const { PgBoss } = await import('pg-boss')", 'src/worker.ts'],
  ])('%s is refused in %s', async (code, file) => {
    expect(await restricted(file, `${code}\nexport {}\n`)).toHaveLength(1)
  })

  test('a page importing the client file is refused (fixture: src/pages/*.astro)', async () => {
    const page = "---\nimport { appDatabase } from '../server/data/client.ts'\nconst n = String(appDatabase)\n---\n<p>{n}</p>\n"
    expect(await restricted('src/pages/fixture.astro', page)).toHaveLength(1)
  })

  test.each([
    ["import { authDatabase } from '../server/data/auth-database'", 'src/pages/x.ts'],
    ["import { authDatabase } from '@/server/data/auth-database'", 'src/components/x.tsx'],
    ["import { authDatabase } from './data/auth-database.ts'", 'src/server/x.ts'],
    ["export { authDatabase } from '../data/auth-database'", 'src/server/jobs/x.ts'],
  ])("the identity tables' handle is refused outside src/server/auth/: %s in %s", async (code, file) => {
    expect(await restricted(file, `${code}\nexport {}\n`)).toHaveLength(1)
  })

  test("src/server/auth/ may import the identity tables' handle, and only that", async () => {
    expect(await restricted('src/server/auth/auth.ts', "import { authDatabase } from '../data/auth-database'\nexport { authDatabase }\n")).toEqual([])
    expect(await restricted('src/server/auth/sub/x.ts', "import { authDatabase } from '@/server/data/auth-database'\nexport { authDatabase }\n")).toEqual([])
    expect(await restricted('src/server/auth/auth.ts', "import { appDatabase } from '../data/client'\nexport { appDatabase }\n")).toHaveLength(1)
  })

  test('the data layer itself may import the driver and its client', async () => {
    const code = "import pg from 'pg'\nimport { db } from './client'\nconst c = await import('pg/lib/client')\nexport { pg, db, c }\n"
    expect(await restricted('src/server/data/x.ts', code)).toEqual([])
    expect(await restricted('src/server/data/sub/y.ts', "import { db } from '../client'\nexport { db }\n")).toEqual([])
  })

  test('the data layer API, and lookalike modules, are importable anywhere', async () => {
    for (const [file, code] of [
      ['src/pages/x.ts', "import { databaseAnswers } from '../server/data/ready'\nexport { databaseAnswers }\n"],
      ['src/server/x.ts', "import { x } from './client'\nexport { x }\n"],
      ['src/server/x.ts', "import { x } from './data/clients'\nexport { x }\n"],
      ['src/pages/x.ts', "import x from 'pgx'\nimport y from 'pg-bossy'\nexport { x, y }\n"],
      ['src/pages/x.ts', "import { eq, sql } from 'drizzle-orm'\nimport { pgTable } from 'drizzle-orm/pg-core'\nexport { eq, sql, pgTable }\n"],
      ['src/pages/x.ts', "const m = await import('./other')\nexport { m }\n"],
    ] as const) {
      expect(await restricted(file, code), `${file}: ${code}`).toEqual([])
    }
  })
})
