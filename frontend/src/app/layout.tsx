import type { Metadata } from 'next'
import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { LanguageProvider } from '@/components/providers/LanguageProvider'
import Navbar from '@/components/layout/Navbar'
import '@/app/globals.css'

export const metadata: Metadata = {
  title: 'Formula AI Global - Chemical Formulation Platform',
  description: 'World\'s First AI-Powered Chemical Formulation Platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider defaultTheme="dark">
          <LanguageProvider defaultLanguage="en">
            <div className="min-h-screen flex flex-col">
              <Navbar />
              <main className="flex-1">{children}</main>
            </div>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}