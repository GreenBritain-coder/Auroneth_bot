import type { Metadata } from 'next'
import './globals.css'

// Force dynamic rendering - admin panel uses auth/cookies, cannot be statically generated
export const dynamic = 'force-dynamic'

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

