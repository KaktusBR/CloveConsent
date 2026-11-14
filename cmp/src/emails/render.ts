// One template, two parts: HTML (React's static markup, every value escaped) and plain text (the same
// element tree, read as text). Templates are plain function components without hooks or state, so the
// text reader can call them directly.
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

export function renderHtml(element: ReactElement): string {
  return `<!DOCTYPE html>${renderToStaticMarkup(element)}`
}

/** Elements whose content is not part of the message text. */
const SKIP = new Set(['head', 'title', 'style', 'script'])
/** Elements that stand as a paragraph of their own in the text. */
const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'li', 'table', 'tr', 'body'])

function text(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') return String(node)
  if (Array.isArray(node)) return node.map(text).join('')
  if (!isValidElement(node)) return ''
  const props = node.props as { children?: ReactNode; href?: string; 'data-text'?: string }
  if (props['data-text'] === 'omit') return ''
  const { type } = node
  if (typeof type === 'function') return text((type as (p: unknown) => ReactNode)(props))
  if (typeof type !== 'string') return text(props.children) // Fragment
  if (SKIP.has(type)) return ''
  if (type === 'br') return '\n'
  const inner = text(props.children)
  if (type === 'a') {
    const label = inner.trim()
    const href = props.href ?? ''
    return label === '' || label === href ? href : `${label}\n${href}`
  }
  return BLOCK.has(type) ? `\n\n${inner.trim()}\n\n` : inner
}

export function renderText(element: ReactElement): string {
  return `${text(element)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`
}
