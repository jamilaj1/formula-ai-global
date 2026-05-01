'use client'
import React, { useEffect, useState } from 'react'
import { useTheme } from '@/components/providers/ThemeProvider'
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw } from 'lucide-react'

interface HealthData {
  status: string
  service: string
  version: string
  timestamp: string
  env: {
    groq_key_set: boolean
    anthropic_key_set: boolean
    ai_primary: string
    supabase_url: string
    supabase_key_preview: string
    supabase_reachable: boolean
    supabase_status?: number
    supabase_error?: string
    stripe_set: boolean
  }
}

export default function DiagnosePage() {
  const { isDark } = useTheme()
  const [data, setData] = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/health', { cache: 'no-store' })
      const j = await res.json()
      setData(j)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'fetch failed')
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const bg = isDark ? 'bg-gray-900 text-white' : 'bg-gray-50 text-gray-900'
  const card = isDark ? 'bg-white/5 border border-white/10' : 'bg-white border border-gray-200 shadow-sm'

  const Item = ({ ok, warn, label, value, hint }: {
    ok?: boolean; warn?: boolean; label: string; value: React.ReactNode; hint?: string
  }) => (
    <div className={`flex items-start gap-3 p-4 rounded-xl ${card}`}>
      {ok ? <CheckCircle2 className="w-6 h-6 text-green-500 shrink-0 mt-0.5" />
       : warn ? <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
       : <XCircle className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <div className="font-semibold">{label}</div>
        <div className={`text-sm font-mono break-all ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{value}</div>
        {hint && <div className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>{hint}</div>}
      </div>
    </div>
  )

  return (
    <div className={`min-h-screen p-4 md:p-8 ${bg}`}>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold">System Diagnostics</h1>
          <button
            onClick={load}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 text-gray-900 font-bold hover:bg-emerald-400"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <p className={`mb-6 text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
          This page shows the runtime configuration of the live deployment.
          If anything below has a red ✗, fix it in Vercel → Project Settings →
          Environment Variables, then Redeploy.
        </p>

        {loading && <div className="opacity-70">Loading...</div>}
        {error && (
          <div className="bg-red-500/10 text-red-400 p-4 rounded-xl">
            {error}
          </div>
        )}

        {data && (
          <div className="space-y-3">
            <Item
              ok={data.env.groq_key_set || data.env.anthropic_key_set}
              warn={!data.env.groq_key_set && data.env.anthropic_key_set}
              label="AI provider"
              value={`Primary: ${data.env.ai_primary}`}
              hint={
                data.env.groq_key_set
                  ? 'Free, no monthly cap (Llama 3.3 70B via Groq).'
                  : data.env.anthropic_key_set
                    ? 'Paid Anthropic only — add GROQ_API_KEY to make searches free.'
                    : 'No AI provider set. Get a free key at console.groq.com.'
              }
            />
            <Item
              ok={data.env.groq_key_set}
              warn={!data.env.groq_key_set}
              label="Groq API key (free tier)"
              value={data.env.groq_key_set ? 'Configured' : 'NOT SET'}
              hint={
                data.env.groq_key_set
                  ? '30 requests/minute, no monthly cap. console.groq.com'
                  : 'Sign up at console.groq.com (free, no card) and add GROQ_API_KEY in Vercel.'
              }
            />
            <Item
              ok={data.env.anthropic_key_set}
              warn={!data.env.anthropic_key_set}
              label="Anthropic API key (fallback)"
              value={data.env.anthropic_key_set ? 'Configured' : 'NOT SET'}
              hint={
                data.env.anthropic_key_set
                  ? 'Used only as fallback if Groq fails. Set spending cap at console.anthropic.com.'
                  : 'Optional. Groq alone is enough for most users.'
              }
            />

            <Item
              ok={data.env.supabase_url !== 'NOT_SET' && data.env.supabase_url !== 'INVALID'}
              label="Supabase URL"
              value={data.env.supabase_url}
              hint="Make sure this matches your project URL exactly. A single typo (b vs v, q vs g) will break sign-up."
            />

            <Item
              ok={data.env.supabase_key_preview !== 'NOT_SET' && data.env.supabase_key_preview !== 'TOO_SHORT'}
              label="Supabase anon key"
          