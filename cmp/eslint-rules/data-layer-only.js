// Tenant isolation: only src/server/data/ may reach the database directly. Elsewhere this rule refuses
// the Postgres drivers (any subpath), drizzle's driver entry points, and the data layer's client module,
// matched on the resolved file (so any relative spelling is caught), in static imports, re-exports,
// dynamic import() and require(). A dynamic import() with a computed specifier is refused too: it
// cannot be checked. The data layer exposes what others may use through its other modules.
//
// One exception (ruling R2): `src/server/data/auth-database.ts` exports `authDatabase`, the handle Better
// Auth's adapter needs for its identity tables. Only `src/server/auth/` may import it; anywhere else it is
// refused like the client.
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const DATA_DIR = resolve(SRC_DIR, 'server', 'data')
const CLIENT = resolve(DATA_DIR, 'client')
const AUTH_DATABASE = resolve(DATA_DIR, 'auth-database')
const AUTH_DIR = resolve(SRC_DIR, 'server', 'auth')

// Postgres client packages (any subpath), and every drizzle-orm subpath except the driver-free query
// builder (`drizzle-orm`, `drizzle-orm/pg-core`): its drivers (node-postgres, postgres-js, neon-*, pglite,
// pg-proxy, aws-data-api/pg, …, and any added later) each open a database connection.
const DRIVERS = /^(pg|pg-pool|pg-native|postgres|@neondatabase\/[^/]+|@vercel\/postgres|@electric-sql\/pglite)(\/.*)?$/
const DRIZZLE_SUBPATH = /^drizzle-orm\/(?!pg-core(\/|$))/
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.cts'])

/** The specifier as a path without extension or /index, when it names a file in this app. */
function resolveLocal(specifier, fromFile) {
  let path
  if (specifier.startsWith('@/')) path = resolve(SRC_DIR, specifier.slice(2))
  else if (specifier.startsWith('.')) path = resolve(dirname(fromFile), specifier)
  else return null
  if (EXTENSIONS.has(extname(path))) path = path.slice(0, -extname(path).length)
  if (path.endsWith(`${sep}index`)) path = path.slice(0, -`${sep}index`.length)
  return path
}

const isInside = (file, dir) => file.toLowerCase().startsWith(`${dir}${sep}`.toLowerCase())

function why(specifier, fromFile) {
  if (DRIVERS.test(specifier) || DRIZZLE_SUBPATH.test(specifier)) return `'${specifier}' is a database driver`
  const local = resolveLocal(specifier, fromFile)
  if (local === null) return null
  if (local.toLowerCase() === CLIENT.toLowerCase()) return `'${specifier}' is the data layer's database client`
  if (local.toLowerCase() === AUTH_DATABASE.toLowerCase() && !isInside(fromFile, AUTH_DIR)) {
    return `'${specifier}' is the identity tables' handle, for src/server/auth/ only`
  }
  return null
}

/** The string value of a literal or an expression-free template, else null. */
function staticString(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked
  return null
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Only src/server/data/ may import the database driver or client; only src/server/auth/ may import authDatabase.' },
    schema: [],
    messages: {
      restricted: '{{why}}: only src/server/data/ talks to the database; use its scoped API.',
      computed: 'A computed import() cannot be checked for database access: use a static specifier.',
    },
  },
  create(context) {
    const file = resolve(context.filename)
    if (isInside(file, DATA_DIR)) return {}

    const check = (source) => {
      if (!source) return
      const specifier = staticString(source)
      if (specifier === null) {
        context.report({ node: source, messageId: 'computed' })
        return
      }
      const reason = why(specifier, file)
      if (reason) context.report({ node: source, messageId: 'restricted', data: { why: reason } })
    }

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      TSImportEqualsDeclaration: (node) => {
        if (node.moduleReference.type === 'TSExternalModuleReference') check(node.moduleReference.expression)
      },
      CallExpression: (node) => {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments[0]) check(node.arguments[0])
      },
    }
  },
}
