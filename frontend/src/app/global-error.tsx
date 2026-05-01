'use client'
import React from 'react'

// Last-resort error boundary that catches errors in the root layout itself.
// Must render its own <html> and <body>.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#0f172a', color: '#f1f5f9' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 480, textAlign: 'center' }}>
            <div style={{ fontSize: 56 }}>⚠️</div>
            <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 16 }}>Application error</h1>
            <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 8 }}>
              {error.message || 'A critical error prevented the app from loading.'}
            </p>
            <button
              onClick={reset}
              style={{
                marginTop: 24,
                background: '#10b981',
                color: '#0f172a',
                border: 'none',
                padding: '10px 20px',
                borderRadius: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
