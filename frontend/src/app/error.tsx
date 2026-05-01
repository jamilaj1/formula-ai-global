'use client'
import React, { useEffect } from 'react'
import Link from 'next/link'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

// Route-level error boundary. Can't consume context from ThemeProvider here
// (boundaries render outside the providers tree), so we rely on CSS variables
// from globals.css that already follow the .dark / .light root classes.
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Route error:', error)
  }, [error])

  return (
    <div
      className="min-h-[60vh] flex items-center justify-center px-4"
      style={{ color: 'var(--foreground)' }}
    >
      <div className="max-w-md text-center">
        <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
        <p className="opacity-70 mb-2 text-sm">{error.message || 'An unexpected error occurred.'}</p>
        {error.digest && (
          <p className="opacity-50 text-xs mb-6">Reference: {error.digest}</p>
        )}
        <div className="flex flex-wrap gap-3 justify-center mt-4">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 bg-emerald-500 text-gray-900 px-5 py-2.5 rounded-xl font-bold hover:bg-emerald-400"
          >
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-emerald-500/10 text-emerald-400 px-5 py-2.5 rounded-xl font-bold hover:bg-emerald-500/20"
          >
            <Home className="w-4 h-4" /> Home
          </Link>
        </div>
      </div>
    </div>
  )
}
