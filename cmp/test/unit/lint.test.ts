import { ESLint } from 'eslint'
import { describe, expect, test } from 'vitest'

const eslint = new ESLint({ cwd: process.cwd() })

async function restricted(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: file })
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message)
}

describe('database client import rule', () => {
  test.each([
    ["import pg from 'pg'", 'src/pages/x.ts'],
    ["import postgres from 'postgres'", 'src/server/auth/x.ts'],
    ["import { drizzle } from 'drizzle-orm/node-postgres'", 'src/server/jobs/x.ts'],
    ["import { db } from '../server/data/client'", 'src/pages/x.ts'],
    ["import { db } from '@/server/data/client'", 'src/components/x.tsx'],
  ])('%s is refused in %s', async (code, file) => {
    expect(await restricted(file, `${code}\nexport { }\n`)).toHaveLength(1)
  })

  test('the data layer itself may import the driver and its client', async () => {
    expect(await restricted('src/server/data/x.ts', "import pg from 'pg'\nimport { db } from './client'\nexport { pg, db }\n")).toEqual([])
  })

  test('the data layer API is importable anywhere', async () => {
    expect(await restricted('src/pages/x.ts', "import { databaseAnswers } from '../server/data/ready'\nexport { databaseAnswers }\n")).toEqual([])
  })
})
