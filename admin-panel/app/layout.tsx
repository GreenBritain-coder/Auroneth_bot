import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Admin Panel - Telegram Bot Platform',
  description: 'Admin dashboard for managing Telegram bots',
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

