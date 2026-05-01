'use client'
import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/providers/AuthProvider'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useLanguage } from '@/components/providers/LanguageProvider'
import GoogleSignInButton from '@/components/GoogleSignInButton'

export default function LoginPage() {
  const router = useRouter()
  const { signIn, configured } = useAuth()
  const { isDark } = useTheme()
  const { t } = useLanguage()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const err = await signIn(email, password)
    if (err) setError(err)
    else router.push('/dashboard')
    setLoading(false)
  }

  const bg = isDark ? 'bg-gray-900' : 'bg-gray-50'
  const card = isDark ? 'bg-white/5' : 'bg-white border border-gray-200 shadow-md'
  const heading = isDark ? 'text-white' : 'text-gray-900'
  const sub = isDark ? 'text-gray-400' : 'text-gray-600'
  const input = isDark
    ? 'bg-white/10 text-white border-white/10 placeholder-gray-400'
    : 'bg-white text-gray-900 border-gray-200 placeholder-gray-500'

  return (
    <div className={`min-h-screen flex items-center justify-center ${bg} p-4`}>
      <div className={`p-8 rounded-2xl w-full max-w-md ${card}`}>
        <h2 className={`text-2xl font-bold mb-6 text-center ${heading}`}>{t('login')}</h2>
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
        <GoogleSignInButton label="Continue with Google" className="mb-4" />
        <div className={`flex items-center gap-3 my-4 text-xs ${sub}`}>
          <div className="flex-1 h-px bg-current opacity-20" />
          <span>or</span>
          <div className="flex-1 h-px bg-current opacity-20" />
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="Email" required
            className={`w-full p-3 rounded-xl border outline-none focus:border-green-400 ${input}`} />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Password" required
            className={`w-full p-3 rounded-xl border outline-none focus:border-green-400 ${input}`} />
          <div className="flex justify-end -mt-1">
            <Link href="/forgot-password" className="text-xs text-green-500 hover:underline">
              Forgot password?
            </Link>
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-green-500 text-gray-900 p-3 rounded-xl font-bold hover:bg-green-400 disabled:opacity-50">
            {loading ? '...' : t('login')}
          </button>
        </form>
        <div className={`text-center mt-6 text-sm ${sub}`}>
          New here?{' '}
          <Link href="/register" className="text-green-500 hover:underline">
            {t('register')}
          </Link>
        </div>
      </div>
    </div>
  )
}
