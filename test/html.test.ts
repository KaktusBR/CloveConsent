import { expect, test } from 'vitest'
import { escapeHtml } from '../src/html'
test('escapes all html-significant characters', () => {
  expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
})
