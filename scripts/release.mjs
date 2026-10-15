import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const version = process.argv[2]
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? '')) { console.error('usage: node scripts/release.mjs <x.y.z>'); process.exit(1) }
// npm is npm.cmd on Windows and needs a shell; git does not (and a shell would split the commit message)
const sh = (cmd) => cmd === 'npm' && process.platform === 'win32'
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', shell: sh(cmd) })
const out = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', shell: sh(cmd) }).trim()

if (out('git', ['status', '--porcelain']) !== '') { console.error('working tree not clean'); process.exit(1) }
const branch = out('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
if (branch !== 'main') { console.error(`release from main only (on ${branch})`); process.exit(1) }
if (out('git', ['tag', '--list', `v${version}`])) { console.error(`tag v${version} exists`); process.exit(1) }

try {
  run('npm', ['ci', '--ignore-scripts'])
  run('npm', ['run', 'typecheck'])
  run('npm', ['test'])
  run('npm', ['run', 'test:astro'])
  run('npm', ['run', 'build'])
  if (!existsSync('dist/index.js')) throw new Error('build produced no dist/index.js')
} catch (err) {
  console.error(`\nrelease aborted before tagging: ${err.message}`)
  process.exit(1)
}

const original = readFileSync('package.json', 'utf8')
let detached = false
try {
  const pkg = JSON.parse(original)
  pkg.version = version
  delete pkg.private
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')

  run('git', ['checkout', '--detach'])
  detached = true
  run('git', ['add', '-f', 'dist', 'package.json'])
  run('git', ['commit', '-m', `release v${version}`])
  run('git', ['tag', '-a', `v${version}`, '-m', `v${version}`])
} catch (err) {
  console.error(`\nrelease failed: ${err.message}`)
  process.exitCode = 1
} finally {
  try {
    if (detached) run('git', ['checkout', '-f', 'main'])
    writeFileSync('package.json', original)
    if (detached) run('git', ['checkout', '--', 'package.json'])
  } catch (e) { console.error(`could not restore main: ${e.message}`); process.exitCode = 1 }
}
if (process.exitCode) process.exit(process.exitCode)
console.log(`\nTagged v${version}. Push with:  git push origin v${version}\nInstall with: npm install github:KaktusBR/CloveConsent#v${version}`)
