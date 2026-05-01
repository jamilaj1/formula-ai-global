'use client'
import React from 'react'
import Link from 'next/link'
import { useTheme } from '@/components/providers/ThemeProvider'
import { Beaker, Home, Search } from 'lucide-react'

export default function NotFound() {
  const { isDark } = useTheme()
  const bg = isDark
    ? 'bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900'
    : 'bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50'
  const heading = isDark ? 'text-white' : 'text-gray-900'
  const sub = isDark ? 'text-gray-300' : 'text-gray-700'

  return (
    <div className={`min-h-screen flex items-center justify-center px-4 ${bg}`}>
      <div className="text-center max-w-md">
        <Beaker className="w-20 h-20 text-green-500 mx-auto mb-6" />
        <div className={`text-6xl font-bold mb-2 ${heading}`}>404</div>
        <h1 className={`text-2xl font-bold mb-3 ${heading}`}>Mixture not found</h1>
        <p className={`mb-8 ${sub}`}>
          The page you&apos;re looking for must have evaporated. Try one of these instead:
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-green-500 text-gray-900 px-6 py-3 rounded-xl font-bold hover:bg-green-400"
          >
            <Home className="w-4 h-4" /> Home
          </Link>
          <Link
            href="/search"
            className={`inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold ${
              isDark ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-gray-900 text-white hover:bg-gray-800'
            }`}
          >
            <Search className="w-4 h-4" /> Search formulas
          </Link>
        </div>
      </div>
    </div>
  )
}
