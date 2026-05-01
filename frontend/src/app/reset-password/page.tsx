'use client'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useTheme } from '@/components/providers/ThemeProvider'
import { KeyRound, CheckCircle2 } from 'lucide-react'

// Supabase sends users to ?code=... which auth-js automatically exchanges for
// a session on page load. After that we just need to call updateUser.
export default function ResetPasswordPage() {
  const router = useRouter()
  const { isDark } = useTheme()
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setError('Auth is not configured')
      setReady(true)
      return
    }
    // Wait briefly so supabase-js can pick up the recovery token from the URL.
    const t = setTimeout(() => setReady(true), 400)
    return () => clearTimeout(t)
  }, [])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) setError(err.message)
      else {
        setDone(true)
        setTimeout(() => router.push('/dashboard'), 1500)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Update failed')
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
          <h2 className={`text-2xl font-bold ${heading}`}>Password updated</h2>
          <p className={`mt-2 ${sub}`}>Redirecting you to your dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`min-h-screen flex items-center justify-center ${bg} p-4`}>
      <div className={`p-8 rounded-2xl w-full max-w-md ${card}`}>
        <KeyRound className="w-12 h-12 text-green-500 mx-auto mb-4" />
        <h2 className={`text-2xl font-bold mb-2 text-center ${heading}`}>Set a new password</h2>
        {!ready && <p className={`text-center mb-4 text-sm ${sub}`}>Verifying reset link...</p>}
        {error && <div className="bg-red-500/20 text-red-300 p-3 rounded-lg mb-4 text-sm">{error}</div>}
        <form onSubmit={onSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password"
            required
            minLength={6}
            disabled={!ready}
            className={`w-full p-3 rounded-xl border outline-none focus:border-green-400 ${input} disabled:opacity-50`}
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm password"
            required
            minLength={6}
            disabled={!ready}
            className={`w-full p-3 rounded-xl border outline-none focus:border-green-400 ${input} disabled:opacity-50`}
          />
          <button
            type="submit"
            disabled={loading || !ready}
            className="w-full bg-green-500 text-gray-900 p-3 rounded-xl font-bold hover:bg-green-400 disabled:opacity-50"
          >
            {loading ? '...' : 'Update password'}
          </button>
        </form>
        <div className={`text-center mt-6 text-sm ${sub}`}>
          <Link href="/login" className="text-green-500 hover:underline">Back to login</Link>
        </div>
      </div>
    </div>
  )
}
