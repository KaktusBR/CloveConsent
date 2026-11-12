import { localizedPath, LOCALE_COOKIE, locales, type Locale } from '@/i18n/locale'
import { m } from '@/paraglide/messages.js'

interface Props {
  /** The current page's path and query without a language prefix, e.g. `/sign-in?next=x`. */
  path: string
  /** The page's language. */
  current: Locale
}

/** Remembered for unprefixed URLs, so picking English sticks even when the browser prefers another language. */
function remember(locale: Locale): void {
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
}

/** Links to the same page in every shipped language, each named in its own language. */
export default function LocaleSwitcher({ path, current }: Props) {
  return (
    <nav aria-label={m.locale_switcher_label()}>
      <ul className="flex gap-3 text-sm">
        {locales.map((locale) => (
          <li key={locale}>
            <a
              href={localizedPath(path, locale)}
              hrefLang={locale}
              lang={locale}
              aria-current={locale === current ? 'true' : undefined}
              className="underline-offset-4 hover:underline aria-[current=true]:font-semibold"
              onClick={() => remember(locale)}
            >
              {m.language_name({}, { locale })}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
