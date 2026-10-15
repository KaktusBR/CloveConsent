import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const SHA = /^[0-9a-f]{40}$/

/** Next release version: the highest vX.Y.Z tag gets its minor bumped; below 1.0.0 (or none) starts at 1.0.0. */
export function nextVersion(tags) {
  let best = null
  for (const tag of tags) {
    const m = TAG.exec(tag)
    if (!m) continue
    const v = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (!best || v[0] > best[0] || (v[0] === best[0] && (v[1] > best[1] || (v[1] === best[1] && v[2] > best[2])))) best = v
  }
  if (!best || best[0] === 0) return '1.0.0'
  return `${best[0]}.${best[1] + 1}.0`
}

/** True when nothing in the change list is worth a release: no files, or only docs/ and top-level *.md. */
export function skipRelease(files) {
  return files.every((f) => f.startsWith('docs/') || /^[^/]+\.md$/.test(f))
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, before, after] = process.argv.slice(2)
  if (cmd === 'next') {
    console.log(nextVersion(git(['tag', '--list', 'v*']).split('\n')))
  } else if (cmd === 'skip') {
    if (!SHA.test(after ?? '')) { console.error('usage: version.mjs skip <before-sha> <after-sha>'); process.exit(1) }
    // a brand-new branch has an all-zero "before": release, there is nothing to compare against
    if (!SHA.test(before ?? '') || /^0+$/.test(before)) console.log('false')
    else console.log(String(skipRelease(git(['diff', '--name-only', before, after]).split('\n').filter(Boolean))))
  } else {
    console.error('usage: version.mjs next | skip <before-sha> <after-sha>')
    process.exit(1)
  }
}
