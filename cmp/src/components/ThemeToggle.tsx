import { Moon } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/button'
import { THEME_STORAGE_KEY } from '@/lib/theme'

const root = () => document.documentElement
const isDark = () => root().classList.contains('dark')

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(root(), { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

interface Props {
  /** The button's accessible name, translated by the page (a pressed button means the dark theme). */
  label: string
}

/** Switches between the light and the dark theme and remembers the choice (read by THEME_SCRIPT). */
export default function ThemeToggle({ label }: Props) {
  // The server cannot know the theme: it renders "not pressed"; the browser reads the real state.
  const dark = useSyncExternalStore(subscribe, isDark, () => false)

  function toggle() {
    const next = !isDark()
    root().classList.toggle('dark', next)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? 'dark' : 'light')
    } catch {
      // storage blocked: the choice lasts for this page only
    }
  }

  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} aria-pressed={dark} onClick={toggle}>
      <Moon aria-hidden="true" />
    </Button>
  )
}
