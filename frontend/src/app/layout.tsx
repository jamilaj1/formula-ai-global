import type { Metadata, Viewport } from 'next'
import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { LanguageProvider } from '@/components/providers/LanguageProvider'
import { AuthProvider } from '@/components/providers/AuthProvider'
import Navbar from '@/components/layout/Navbar'
import PWARegister from '@/components/PWARegister'
import '@/app/globals.css'

export const metadata: Metadata = {
  title: 'Formula AI Global - Chemical Formulation Platform',
  description:
    "World's First AI-Powered Chemical Formulation Platform - search, extract, and validate chemical formulas in seconds.",
  manifest: '/manifest.json',
  applicationName: 'Formula AI',
  keywords: ['chemistry', 'formulation', 'cosmetics', 'cleaning products', 'AI', 'CAS number'],
  authors: [{ name: 'Formula AI Global' }],
  icons: { icon: '/icon-192.svg', apple: '/icon-192.svg' },
  openGraph: {
    title: 'Formula AI Global',
    description: 'AI-powered chemical formulation platform',
    type: 'website',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
    { media: '(prefers-color-scheme: light)', color: '#10b981' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider defaultTheme="dark">
          <LanguageProvider defaultLanguage="en">
            <AuthProvider>
              <div className="min-h-screen flex flex-col">
                <Navbar />
                <main className="flex-1">{children}</main>
              </div>
              <PWARegister />
            </AuthProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
