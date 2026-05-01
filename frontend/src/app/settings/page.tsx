'use client'
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useLanguage } from '@/components/providers/LanguageProvider'
import { User as UserIcon, KeyRound, LogOut, AlertTriangle, Save } from 'lucide-react'

type Profile = { full_name: string | null; plan: string }

export default function SettingsPage() {
  const router = useRouter()
  const { isDark } = useTheme()
  const { t } = useLanguage()
  const [email, setEmail] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [name, setName] = useState('')
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingName, setSavingName] = useState(false)
  const [savingPwd, setSavingPwd] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      if (!isSupabaseConfigured) {
        if (mounted) setLoading(false)
        return
      }
      const { data: u } = await supabase.auth.getUser()
      if (!u.user) {
        if (mounted) {
          setLoading(false)
          router.push('/login')
        }
        return
      }
      if (mounted) setEmail(u.user.email || null)

      const { data: p } = await supabase
        .from('profiles')
        .select('full_name, plan')
        .eq('id', u.user.id)
        .maybeSingle()

      if (!mounted) return
      const prof = (p as Profile) || { full_name: null, plan: 'starter' }
      setProfile(prof)
      setName(prof.full_name || '')
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
  }, [router])

  const updateName = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingName(true)
    setMsg(null)
    try {
      const { data: u } = await supabase.auth.getUser()
      if (!u.user) return
      const [authResult, profResult] = await Promise.all([
        supabase.auth.updateUser({ data: { full_name: name } }),
        supabase.from('profiles').upsert({ id: u.user.id, full_name: name }),
      ])
      if (authResult.error) throw authResult.error
      if (profResult.error) throw profResult.error
      setMsg({ kind: 'ok', text: 'Name updated' })
      setProfile((p) => (p ? { ...p, full_name: name } : p))
    } catch (err: unknown) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Update failed' })
    }
    setSavingName(false)
  }

  const updatePwd = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    if (pwd.length < 6) return setMsg({ kind: 'err', text: 'Password must be 6+ characters' })
    if (pwd !== pwd2) return setMsg({ kind: 'err', text: 'Passwords do not match' })
    setSavingPwd(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd })
      if (error) throw error
      setMsg({ kind: 'ok', text: 'Password changed' })
      setPwd('')
      setPwd2('')
    } catch (err: unknown) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Update failed' })
    }
    setSavingPwd(false)
  }

  const logout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const bg = isDark ? 'bg-gray-900' : 'bg-gray-50'
  const heading = isDark ? 'text-white' : 'text-gray-900'
  const sub = isDark ? 'text-gray-400' : 'text-gray-600'
  const card = isDark ? 'bg-white/5 border border-white/5' : 'bg-white border border-gray-200 shadow-sm'
  const input = isDark
    ? 'bg-white/10 text-white border-white/10'
    : 'bg-white text-gray-900 border-gray-200'
  const btn = isDark
    ? 'bg-white/10 text-gray-200 hover:bg-white/20'
    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'

  if (loading) {
    return (
      <div className={`min-h-screen p-8 ${bg}`}>
        <div className={`max-w-2xl mx-auto ${sub}`}>Loading...</div>
      </div>
    )
  }

  return (
    <div className={`min-h-screen p-4 md:p-8 ${bg}`}>
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className={`text-3xl font-bold ${heading}`}>Settings</h1>

        {msg && (
          <div
            className={`p-3 rounded-lg text-sm ${
              msg.kind === 'ok' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
            }`}
          >
            {msg.text}
          </div>
        )}

        {/* Account info */}
        <section className={`rounded-2xl p-6 ${card}`}>
          <div className="flex items-center gap-2 mb-4">
            <UserIcon className="w-5 h-5 text-green-500" />
            <h2 className={`text-lg font-bold ${heading}`}>Account</h2>
          </div>
          <div className={`text-sm mb-4 ${sub}`}>
            <span className="opacity-70">Email:</span> <span className={heading}>{email}</span>
            <br />
            <span className="opacity-70">Plan:</span>{' '}
            <span className="capitalize">{profile?.plan || 'starter'}</span>
            {profile?.plan === 'starter' && (
              <>
                {' '}
                · <Link href="/pricing" className="text-green-500 hover:underline">upgrade</Link>
              </>
            )}
          </div>
          <form onSubmit={updateName} className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              className={`flex-1 p-3 rounded-xl border outline-none focus:border-green-400 ${input}`}
            />
            <button
              type="submit"
              disabled={savingName}
              className="bg-green-500 text-gray-900 px-4 py-3 rounded-xl font-bold hover:bg-green-400 disabled:opacity-50 flex items-center gap-2"
            >
              <Save className="w-4 h-4" /> Save
            </button>
          </form>
        </section>

        {/* Password */}
        <section className={`rounded-2xl p-6 ${card}`}>
          <div className="flex items-center gap-2 mb-4">
            <KeyRound className="w-5 h-5 text-green-500" />
            <h2 className={`text-lg font-bold ${heading}`}>Change password</h2>
          </div>
          <form onSubmit={updatePwd} className="space-y-3">
            <input
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder="New password"
              minLength={6}
              required
              className={`w-full p-3 rounded-xl border outline-none focus:border-green-400 ${input}`}
            />
            <input
              type="password"
              value={pwd2}
              onChange={(e) => setPwd2(e.target.value)}
              placeholder="Confirm password"
              minLength={6}
              required
              className={`w-full p-3 rounded-xl border outline-none focus:border-green-400 ${input}`}
            />
            <button
              type="submit"
              disabled={savingPwd}
              className="bg-green-500 text-gray-900 px-4 py-3 rounded-xl font-bold hover:bg-green-400 disabled:opacity-50"
            >
              {savingPwd ? '...' : 'Change password'}
            </button>
          </form>
        </section>

        {/* Sign out */}
        <section className={`rounded-2xl p-6 ${card}`}>
          <button onClick={logout} className={`flex items-center gap-2 px-4 py-2 rounded-lg ${btn}`}>
            <LogOut className="w-4 h-4" /> {t('logout')}
          </button>
        </section>

        {/* Danger zone */}
        <section className="rounded-2xl p-6 border border-red-500/30 bg-red-500/5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <h2 className="text-lg font-bold text-red-400">Danger zone</h2>
          </div>
          <p className={`text-sm mb-4 ${sub}`}>
            To permanently delete your account and all your data, contact support. (Self-serve
            account deletion will arrive in a later release.)
          </p>
          <a
            href="mailto:support@jamilformula.com?subject=Delete%20my%20account"
            className="inline-block bg-red-500/20 text-red-400 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-500/30"
          >
            Request account deletion
          </a>
        </section>
      </div>
    </div>
  )
}
