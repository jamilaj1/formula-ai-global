'use client'
import React, { useState } from 'react'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useLanguage } from '@/components/providers/LanguageProvider'
import { useAuth } from '@/components/providers/AuthProvider'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, BookmarkCheck, Bookmark } from 'lucide-react'

type Component = { name?: string; percentage?: string; cas_number?: string; function?: string }
type ExtractedFormula = {
  name?: string
  category?: string
  components?: Component[]
  notes?: string
}

type UploadResp = {
  success?: boolean
  error?: string
  formulas?: ExtractedFormula[]
  pages?: number
  chunks_processed?: number
  chunks_failed?: number
  raw_extracted?: number
  filtered_out?: number
  stopped_early?: boolean
}

export default function UploadPage() {
  const { isDark } = useTheme()
  const { t, language } = useLanguage()
  const { user } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ formulas: ExtractedFormula[]; pages?: number; chunks_processed?: number } | null>(null)
  const [savedAll, setSavedAll] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [savingAll, setSavingAll] = useState(false)

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null
    setFile(f)
    setResult(null)
    setError('')
    setSavedAll(false)
    setSavedCount(0)
  }

  const persistResults = async (formulas: ExtractedFormula[], filename: string, sizeBytes: number) => {
    if (!user?.id || !isSupabaseConfigured) return
    try {
      await supabase.from('uploaded_books').insert({
        user_id: user.id,
        filename,
        size_bytes: sizeBytes,
        formulas_extracted: formulas.length,
        status: 'completed',
      })
    } catch (err) {
      console.error('Failed to record upload:', err)
    }
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return
    setUploading(true)
    setError('')
    setProgress(0)
    setResult(null)
    setSavedAll(false)
    setSavedCount(0)

    const tick = setInterval(() => setProgress((p) => (p < 95 ? p + 1 : p)), 2000)

    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('language', language)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })

      // Read as text first so we can show server error pages (HTML / Vercel timeout)
      const raw = await res.text()
      let data: UploadResp = {}
      try {
        data = JSON.parse(raw) as UploadResp
      } catch {
        if (res.status === 504 || raw.toLowerCase().includes('timeout')) {
          throw new Error('The book is very large; the server timed out before finishing. Please try a smaller PDF (under 200 pages).')
        }
        throw new Error(`Server error (${res.status}): ${raw.slice(0, 200)}`)
      }
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`)
      setProgress(100)
      const formulas: ExtractedFormula[] = data.formulas || []
      setResult({ formulas, pages: data.pages, chunks_processed: data.chunks_processed })

      await persistResults(formulas, file.name, file.size)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      clearInterval(tick)
      setUploading(false)
    }
  }

  const componentsToText = (f: ExtractedFormula): string => {
    const lines: string[] = []
    if (f.name) lines.push(`# ${f.name}`)
    if (f.category) lines.push(`*Category: ${f.category}*`)
    lines.push('')
    if (f.components && f.components.length > 0) {
      lines.push('| # | Component | CAS | % | Function |')
      lines.push('|---|---|---|---|---|')
      f.components.forEach((c, i) => {
        lines.push(`| ${i + 1} | ${c.name || ''} | ${c.cas_number || ''} | ${c.percentage || ''} | ${c.function || ''} |`)
      })
    }
    if (f.notes) {
      lines.push('')
      lines.push(`**Notes:** ${f.notes}`)
    }
    return lines.join('\n')
  }

  const saveAllToLibrary = async () => {
    if (!user?.id || !isSupabaseConfigured || !result) return
    setSavingAll(true)
    let saved = 0
    for (const f of result.formulas) {
      try {
        const { error: insertErr } = await supabase.from('saved_formulas').insert({
          user_id: user.id,
          name: f.name || 'Untitled formula',
          category: f.category || null,
          components: f.components || [],
          notes: componentsToText(f),
        })
        if (!insertErr) saved += 1
      } catch (err) {
        console.error('Save formula failed:', err)
      }
    }
    setSavedCount(saved)
    setSavedAll(true)
    setSavingAll(false)
  }

  const bg = isDark ? 'bg-gray-900' : 'bg-gray-50'
  const heading = isDark ? 'text-white' : 'text-gray-900'
  const sub = isDark ? 'text-gray-400' : 'text-gray-600'
  const card = isDark ? 'bg-white/5 border border-white/5' : 'bg-white border border-gray-200 shadow-sm'
  const dropZone = isDark
    ? 'border-white/20 hover:border-green-400 bg-white/5'
    : 'border-gray-300 hover:border-green-500 bg-gray-50'

  return (
    <div className={`min-h-screen p-4 md:p-8 ${bg}`}>
      <div className="max-w-3xl mx-auto">
        <h1 className={`text-3xl font-bold mb-2 ${heading}`}>{t('upload_book')}</h1>
        <p className={`mb-8 ${sub}`}>
          Upload a PDF book and AI will extract every chemical formula it contains.
        </p>

        <form onSubmit={onSubmit} className={`rounded-2xl p-6 ${card}`}>
          <label className={`block border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${dropZone}`}>
            <input type="file" accept="application/pdf" onChange={onPick} className="hidden" />
            <Upload className={`w-12 h-12 mx-auto mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} />
            <div className={`font-medium ${heading}`}>
              {file ? file.name : 'Click to select a PDF (max 25 MB)'}
            </div>
            {file && (
              <div className={`text-sm mt-1 ${sub}`}>{(file.size / 1024 / 1024).toFixed(2)} MB</div>
            )}
          </label>

          {uploading && (
            <div className="mt-4">
              <div className={`h-2 rounded-full overflow-hidden ${isDark ? 'bg-white/10' : 'bg-gray-200'}`}>
                <div className="h-full bg-green-500 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <div className={`text-sm mt-2 flex items-center gap-2 ${sub}`}>
                <Loader2 className="w-4 h-4 animate-spin" />
                Extracting formulas... {progress}%
              </div>
              <div className={`text-xs mt-1 ${sub}`}>
                Large books are processed in chunks - this can take up to 5 minutes.
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 flex items-start gap-2 bg-red-500/10 text-red-400 p-3 rounded-lg text-sm">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!file || uploading}
            className="w-full mt-6 bg-green-500 text-gray-900 py-3 rounded-xl font-bold hover:bg-green-400 disabled:opacity-50"
          >
            {uploading ? 'Processing...' : 'Extract Formulas'}
          </button>
        </form>

        {result && (
          <div className={`mt-8 rounded-2xl p-6 ${card}`}>
            <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-6 h-6 text-green-500" />
                <h2 className={`text-xl font-bold ${heading}`}>
                  {result.formulas.length} formula{result.formulas.length !== 1 ? 's' : ''} extracted
                  {result.pages ? ` from ${result.pages} pages` : ''}
                  {result.chunks_processed && result.chunks_processed > 1 ? ` (${result.chunks_processed} chunks)` : ''}
                </h2>
              </div>
              {user && result.formulas.length > 0 && (
                <button
                  onClick={saveAllToLibrary}
                  disabled={savedAll || savingAll}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold ${
                    savedAll
                      ? 'bg-emerald-500/20 text-emerald-300 cursor-default'
                      : 'bg-emerald-500 text-gray-900 hover:bg-emerald-400 disabled:opacity-50'
                  }`}
                >
                  {savedAll ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                  {savingAll
                    ? 'Saving...'
                    : savedAll
                      ? `Saved ${savedCount} to library`
                      : 'Save all to my library'}
                </button>
              )}
            </div>

            {result.formulas.length === 0 ? (
              <p className={sub}>No complete formulas were found in the document.</p>
            ) : (
              <div className="space-y-4">
                {result.formulas.map((f, i) => (
                  <div key={i} className={`rounded-xl p-4 ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
                    <div className="flex items-start gap-3">
                      <FileText className="w-5 h-5 text-green-500 shrink-0 mt-1" />
                      <div className="flex-1">
                        <div className={`font-semibold ${heading}`}>
                          {f.name || `Formula ${i + 1}`}
                        </div>
                        {f.category && <div className={`text-sm ${sub}`}>{f.category}</div>}
                        {f.components && f.components.length > 0 && (
                          <ul className={`mt-2 text-sm space-y-1 ${sub}`}>
                            {f.components.slice(0, 8).map((c, j) => (
                              <li key={j}>
                                {c.percentage ? <strong>{c.percentage}</strong> : null}{' '}
                                {c.name}
                                {c.cas_number ? ` (CAS ${c.cas_number})` : ''}
                              </li>
                            ))}
                            {f.components.length > 8 && <li>+ {f.components.length - 8} more</li>}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
