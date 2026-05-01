'use client'
import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

interface AuthContextType {
  user: User | null
  loading: boolean
  configured: boolean
  signIn: (email: string, password: string) => Promise<string | null>
  signUp: (email: string, password: string, fullName?: string) => Promise<string | null>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<string | null>
}

const NOT_CONFIGURED_MSG =
  'Authentication is not configured on this deployment. The administrator must set ' +
  'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel ' +
  '(Project Settings → Environment Variables) and Redeploy.'

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  configured: false,
  signIn: async () => NOT_CONFIGURED_MSG,
  signUp: async () => NOT_CONFIGURED_MSG,
  signOut: async () => {},
  resetPassword: async () => NOT_CONFIGURED_MSG,
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }

    let mounted = true
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      setUser(session?.user ?? null)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, password: string): Promise<string | null> => {
    if (!isSupabaseConfigured) return NOT_CONFIGURED_MSG
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return error?.message ?? null
    } catch (err: unknown) {
      // 'Failed to fetch' usually means CORS, no network, or wrong URL.
      const msg = err instanceof Error ? err.message : 'Sign-in failed'
      if (/failed to fetch|network/i.test(msg)) {
        return 'Cannot reach the auth server. Check that NEXT_PUBLIC_SUPABASE_URL is correct and that your Supabase project is online.'
      }
      return msg
    }
  }

  const signUp = async (
    email: string,
    password: string,
    fullName?: string
  ): Promise<string | null> => {
    if (!isSupabaseConfigured) return NOT_CONFIGURED_MSG
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: fullName ? { data: { full_name: fullName } } : undefined,
      })
      return error?.message ?? null
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Registration failed'
      if (/failed to fetch|network/i.test(msg)) {
        return 'Cannot reach the auth server. Check that NEXT_PUBLIC_SUPABASE_URL is correct and that your Supabase project is online.'
      }
      return msg
    }
  }

  const signOut = async (): Promise<void> => {
    if (!isSupabaseConfigured) return
    await supabase.auth.signOut()
  }

  const resetPassword = async (email: string): Promise<string | null> => {
    if (!isSupabaseConfigured) return NOT_CONFIGURED_MSG
    try {
      const redirectTo =
        typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
      return error?.message ?? null
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Reset failed'
      return msg
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, configured: isSupabaseConfigured, signIn, signUp, signOut, resetPassword }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
