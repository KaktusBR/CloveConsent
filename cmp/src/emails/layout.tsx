// The building blocks of every email. Inline styles only, no images, fonts or stylesheets from anywhere:
// the message shows the same with remote content blocked. Text comes from the catalog; values are
// escaped by React. Elements marked data-text="omit" are left out of the plain-text part.
import type { CSSProperties, ReactNode } from 'react'
import type { Locale } from '../i18n/locale'
import { m } from '../paraglide/messages.js'

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
const BODY: CSSProperties = { margin: 0, padding: '24px 12px', backgroundColor: '#f4f4f5', color: '#18181b', fontFamily: FONT, fontSize: '16px', lineHeight: 1.5 }
const CARD: CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '32px', backgroundColor: '#ffffff', borderRadius: '8px' }
const BRAND: CSSProperties = { margin: '0 0 24px', fontSize: '18px', fontWeight: 700 }
const PARAGRAPH: CSSProperties = { margin: '0 0 16px' }
const BUTTON: CSSProperties = { display: 'inline-block', padding: '12px 20px', backgroundColor: '#18181b', color: '#ffffff', borderRadius: '6px', fontWeight: 600, textDecoration: 'none' }
const SMALL: CSSProperties = { margin: '0 0 16px', fontSize: '13px', color: '#52525b', wordBreak: 'break-all' }
const LINK: CSSProperties = { color: '#18181b' }
const FOOTER: CSSProperties = { margin: '32px 0 0', fontSize: '13px', color: '#71717a' }

export function Email({ locale, title, children }: { locale: Locale; title: string; children: ReactNode }) {
  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <title>{title}</title>
      </head>
      <body style={BODY}>
        <div style={CARD}>
          <p style={BRAND}>{m.email_brand({}, { locale })}</p>
          {children}
          <p style={FOOTER}>{m.email_footer({}, { locale })}</p>
        </div>
      </body>
    </html>
  )
}

export function Paragraph({ children }: { children: ReactNode }) {
  return <p style={PARAGRAPH}>{children}</p>
}

/** The email's one action: a button, and the link written out for clients that do not show it. */
export function Action({ href, locale, children }: { href: string; locale: Locale; children: ReactNode }) {
  return (
    <>
      <p style={{ margin: '24px 0' }}>
        <a href={href} style={BUTTON}>
          {children}
        </a>
      </p>
      <p style={SMALL} data-text="omit">
        {m.email_link_fallback({}, { locale })}
        <br />
        <a href={href} style={LINK}>
          {href}
        </a>
      </p>
    </>
  )
}
