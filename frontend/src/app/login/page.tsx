'use client'
import React, { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useLanguage } from '@/components/providers/LanguageProvider'

export default function LoginPage() {
  const router = useRouter()
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
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) setError(authError.message)
      else router.push('/dashboard')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed')
    }
    setLoading(false)
  }

  const bg = isDark ? 'bg-gray-900' : 'bg-gray-50'
  const card = isDark ? 'bg-white/5' : 'bg-white border border-gray-200 shadow-md'
  const heading = isDark ? 'text-white' : 'text-gray-900'
  const input = isDark
    ? 'bg-white/10 text-white border-white/10 placeholder-gray-400'
    : 'bg-white text-gray-900 border-gray-200 placeholder-gray-500'

  return (
    <div className={`min-h-screen flex items-center justify-center ${bg}`}>
      <div className={`p-8 rounded-2xl w-full max-w-md ${card}`}>
        <h2 className={`text-2xl font-bold mb-6 text-center ${heading}`}>{t('login')}</h2>
        {error && <div className="bg-red-500/20 text-red-300 p-3 rounded-lg mb-4 text-sm">{error}</div>}
        <form onSubmit={handleLogin} className="space-y-4">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="Email" required
            className={`w-full p-3 rounded-xl border outline-none focus:border-green-400 ${input}`} />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Password" required
            className={`w-full p-3 rounded-xl border outline-none focus:border-green-400 ${input}`} />
          <button type="submit" disabled={loading}
            className="w-full bg-green-500 text-gray-900 p-3 rounded-xl font-bold hover:bg-green-400 disabled:opacity-50">
            {loading ? '...' : t('login')}
          </button>
        </form>
      </div>
    </div>
  )
}
