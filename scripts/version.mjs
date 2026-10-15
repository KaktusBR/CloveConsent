import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
export const LABELS = ['release:major', 'release:minor', 'release:patch', 'release:none']

/** Highest plain vX.Y.Z tag as [major, minor, patch], or null. */
export function latest(tags) {
  let best = null
  for (const tag of tags) {
    const m = TAG.exec(tag)
    if (!m) continue
    const v = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (!best || v[0] > best[0] || (v[0] === best[0] && (v[1] > best[1] || (v[1] === best[1] && v[2] > best[2])))) best = v
  }
  return best
}

/** The single release label of a pull request, or an error that says what to do. */
export function pickLabel(labels) {
  const found = labels.filter((l) => LABELS.includes(l))
  if (found.length === 0) return { error: `add exactly one release label: ${LABELS.join(', ')}` }
  if (found.length > 1) return { error: `more than one release label (${found.join(', ')}): keep exactly one` }
  return { label: found[0] }
}

/** Next version for a label; null for release:none. Before 1.0 a major (breaking) bumps the minor and anything else the patch. */
export function nextVersion(tags, label) {
  if (!LABELS.includes(label)) throw new Error(`unknown label ${label}`)
  if (label === 'release:none') return null
  const cur = latest(tags)
  if (cur === null) return '0.1.0'
  const [major, minor, patch] = cur
  const kind = label.slice('release:'.length)
  if (major === 0) return kind === 'major' ? `0.${minor + 1}.0` : `0.${minor}.${patch + 1}`
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

export function plan(tags, labels) {
  const picked = pickLabel(labels)
  if ('error' in picked) return { skip: picked.error }
  const version = nextVersion(tags, picked.label)
  return version === null ? { skip: 'release:none' } : { release: version }
}

export function parseLabels(json) {
  let v
  try { v = JSON.parse(json) } catch { throw new Error('labels must be a JSON array of strings') }
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new Error('labels must be a JSON array of strings')
  return v
}

function gitTags() {
  return execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, labelsJson] = process.argv.slice(2)
  try {
    if (cmd === 'plan') {
      console.log(JSON.stringify(plan(gitTags(), parseLabels(labelsJson ?? ''))))
    } else if (cmd === 'check-labels') {
      const picked = pickLabel(parseLabels(labelsJson ?? ''))
      if ('error' in picked) { console.error(picked.error); process.exit(1) }
      console.log(`release label: ${picked.label}`)
    } else {
      console.error('usage: version.mjs plan <labels-json> | check-labels <labels-json>')
      process.exit(1)
    }
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
