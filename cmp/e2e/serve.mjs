// Starts the built server for the e2e run (playwright.config.ts) and tees its output: into the log file
// named by the first argument (e2e/isolation.spec.ts reads the lines of its requests there), and on to
// this process's stdout and stderr, so a server that fails to boot still shows why in Playwright's output.
// Have I Been Pwned is answered by the local stand-in (e2e/pwned-stand-in.mjs).
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'

const file = process.argv[2]
if (!file) throw new Error('usage: node e2e/serve.mjs <log file>')
const log = createWriteStream(file, { flags: 'w' })
const server = spawn(process.execPath, ['--import', './e2e/pwned-stand-in.mjs', 'dist/server/entry.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] })
server.stdout.on('data', (chunk) => {
  log.write(chunk)
  process.stdout.write(chunk)
})
server.stderr.on('data', (chunk) => {
  log.write(chunk)
  process.stderr.write(chunk)
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal))
server.on('exit', (code, signal) => {
  log.end(() => process.exit(code ?? (signal ? 1 : 0)))
})
