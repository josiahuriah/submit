import type { Metadata } from 'next'
import { IBM_Plex_Sans, IBM_Plex_Sans_Condensed, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

// Self-hosted via next/font (no external <link>, no layout shift). theme.css
// maps these variables onto --sb-font-ui / --sb-font-cond / --sb-font-mono.
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-sans',
})
const plexCond = IBM_Plex_Sans_Condensed({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-plex-cond',
})
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
})

export const metadata: Metadata = {
  title: 'Submit — Customs Brokerage Platform',
  description: 'Prepare, calculate, and submit Bahamian customs declarations with financial certainty.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexCond.variable} ${plexMono.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  )
}
