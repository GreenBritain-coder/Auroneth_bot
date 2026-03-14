import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Telegram Bot Platform',
  description: 'Discover and use Telegram bots',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

