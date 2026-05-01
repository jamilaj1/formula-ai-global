'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useTheme } from '@/components/providers/ThemeProvider'
import { Mail, CheckCircle2 } from 'lucide-react'

export default function ForgotPasswordPage() {
  const { isDark } = useTheme()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isSupabaseConfigured) {
      setError('Auth is not configured')
      return
    }
    setLoading(true)
    setError('')
    try {
      const redirectTo = `${window.location.origin}/reset-password`
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
      if (err) setError(err.message)
      else setDone(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Request failed')
    }
    setLoading(false)
  }

  const bg = isDark ? 'bg-gray-900' : 'bg-gray-50'
  const card = isDark ? 'bg-white/5' : 'bg-white border border-gray-200 shadow-md'
  const heading = isDark ? 'text-white' : 'text-gray-900'
  const sub = isDark ? 'text-gray-400' : 'text-gray-600'
  const input = isDark
    ? 'bg-white/10 text-white border-white/10 placeholder-gray-400'
    : 'bg-white text-gray-900 border-gray-200 placeholder-gray-500'

  if (done) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${bg} p-4`}>
        <div className={`p-8 rounded-2xl w-full max-w-md text-center ${card}`}>
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className={`text-2xl font-bold mb-2 ${heading}`}>Check your inbox</h2>
          <p className={sub}>
            If an account exists for <strong>{email}</strong>, we just sent a password reset link.
          </p>
          <Link href="/login" className="inline-block mt-6 text-green-500 hover:underline">
            Back to login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className={`min-h-screen flex items-center justify-center ${bg} p-4`}>
      <div className={`p-8 rounded-2xl w-full max-w-md ${card}`}>
        <Mail className="w-12 h-12 text-green-500 mx-auto mb-4" />
        <h2 className={`text-2xl font-bold mb-2 text-center ${heading}`}>Reset password</h2>
        <p className={`text-center mb-6 text-sm ${sub}`}>
          Enter your email and we&apos;ll send you a link to set a new password.
        </p>
        {error && <div className="bg-red-500/20 text-red-300 p-3 rounded-lg mb-4 text-sm">{error}</div>}
        <form onSubmit={onSubmit} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            required
            className={`w-full p-3 rounded-xl border outline-none focus:border-green-400 ${input}`}
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-500 text-gray-900 p-3 rounded-xl font-bold hover:bg-green-400 disabled:opacity-50"
          >
            {loading ? '...' : 'Send reset link'}
          </button>
        </form>
        <div className={`text-center mt-6 text-sm ${sub}`}>
          Remembered it?{' '}
          <Link href="/login" className="text-green-500 hover:underline">Sign in</Link>
        </div>
      </div>
    </div>
  )
}
