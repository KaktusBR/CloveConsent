/** Where the reader's explicit theme choice lives: "light" | "dark"; absent = follow the system. */
export const THEME_STORAGE_KEY = 'theme'

/**
 * Sets the `dark` class before first paint: the stored choice, else the system preference.
 * Rendered inline by src/layouts/Base.astro; the CSP allows it by its hash (astro.config.mjs), so
 * any change here changes the hash with it.
 */
export const THEME_SCRIPT = `(() => {
  let stored = null
  try {
    stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})
  } catch {
    // storage blocked: follow the system preference
  }
  const dark = stored === 'dark' || (stored !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
})()`
