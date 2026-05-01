'use client'
import React, { useState } from 'react'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useLanguage } from '@/components/providers/LanguageProvider'
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'

type ExtractedFormula = {
  name?: string
  category?: string
  components?: Array<{ name?: string; percentage?: string; cas_number?: string; function?: string }>
  notes?: string
}

export default function UploadPage() {
  const { isDark } = useTheme()
  const { t, language } = useLanguage()
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ formulas: ExtractedFormula[]; pages?: number } | null>(null)

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null
    setFile(f)
    setResult(null)
    setError('')
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return
    setUploading(true)
    setError('')
    setProgress(0)
    setResult(null)

    // Animate progress while we wait for the API
    const tick = setInterval(() => setProgress((p) => (p < 90 ? p + 5 : p)), 600)

    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('language', language)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`)
      setProgress(100)
      setResult({ formulas: data.formulas || [], pages: data.pages })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      clearInterval(tick)
      setUploading(false)
    }
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
          <label
            className={`block border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${dropZone}`}
          >
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
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 className="w-6 h-6 text-green-500" />
              <h2 className={`text-xl font-bold ${heading}`}>
                {result.formulas.length} formula{result.formulas.length !== 1 ? 's' : ''} extracted
                {result.pages ? ` from ${result.pages} pages` : ''}
              </h2>
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
