'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/providers/AuthProvider'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useLanguage } from '@/components/providers/LanguageProvider'
import { CheckCircle2 } from 'lucide-react'

export default function RegisterPage() {
  const router = useRouter()
  const { signUp, configured } = useAuth()
  const { isDark } = useTheme()
  const { t } = useLanguage()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    setLoading(true)
    setError('')
    const err = await signUp(email, password, name || undefined)
    if (err) {
      setError(err)
    } else {
      setDone(true)
      // Some Supabase projects auto-sign-in; others require confirmation.
      // Either way, send to dashboard after a brief moment.
      setTimeout(() => router.push('/dashboard'), 2000)
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
          <h2 className={`text-2xl font-bold mb-2 ${heading}`}>Account created</h2>
          <p className={sub}>
            Welcome aboard. If your project requires email confirmation, check{' '}
            <strong>{email}</strong>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={`min-h-screen flex items-center justify-center ${bg} p-4`}>
      <div className={`p-8 rounded-2xl w-full max-w-md ${card}`}>
        <h2 className={`text-2xl font-bold mb-2 text-center ${heading}`}>{t('register')}</h2>
        <p className={`text-center mb-6 text-sm ${sub}`}>Get 10 free formulas every month</p>
        {!configured && (
          <div className="bg-amber-500/15 border border-amber-500/30 text-amber-200 p-3 rounded-lg mb-4 text-sm">
            <strong>Auth is not configured on this deployment.</strong>
            <br />
            The site administrator must add{' '}
            <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
            <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in
            Vercel → Project Settings → Environment Variables, then Redeploy.
          </div>
        )}
        {error && <div className="bg-red-500/20 text-red-300 p-3 rounded-lg mb-4 text-sm">{error}</div>}
        <form onSubmit={handleRegister} className="space-y-4">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className={`w-full p-3 rounded-xl border outline-none focus:border-green-400 ${input}`} />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="Email" required
            className={`w-full p-3 rounded-xl border outline-none focus:border-green-400 ${input}`} />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (6+ chars)" required minLength={6}
            className={`w-full p-3 rounded-xl border outline-none focus:border-green-400 ${input}`} />
          <button type="submit" disabled={loading}
            className="w-full bg-green-500 text-gray-900 p-3 rounded-xl font-bold hover:bg-green-400 disabled:opacity-50">
            {loading ? '...' : 'Create account'}
          </button>
        </form>
        <div className={`text-center mt-6 text-sm ${sub}`}>
          Already have an account?{' '}
          <Link href="/login" className="text-green-500 hover:underline">{t('login')}</Link>
        </div>
      </div>
    </div>
  )
}
