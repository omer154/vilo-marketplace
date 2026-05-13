import type { Metadata } from 'next'
import './globals.css'
import Toaster from '@/components/layout/Toaster'

export const metadata: Metadata = {
  title: 'Vilo Marketplace',
  description: 'מרקטפלייס ספקים — Vilo HR Technologies',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html dir="rtl" lang="he">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans">
        {children}
        <Toaster />
      </body>
    </html>
  )
}
