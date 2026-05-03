'use client'
import React, { useState } from 'react'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useAuth } from '@/components/providers/AuthProvider'
import { Upload, Download, CheckCircle2, AlertCircle, FileSpreadsheet, Loader2 } from 'lucide-react'

const TEMPLATE_CSV = `formula_name,category,component_name,cas_number,percentage,function,notes
Anti-Aging Cream,skincare,Glycerin,56-81-5,5,Humectant,Apply morning and night
Anti-Aging Cream,skincare,Niacinamide,98-92-0,5,Active ingredient,
Anti-Aging Cream,skincare,Hyaluronic Acid,9067-32-7,1,Hydrating agent,
Anti-Aging Cream,skincare,Cetyl Alcohol,36653-82-4,3,Emollient,
Anti-Aging Cream,skincare,Phenoxyethanol,122-99-6,0.8,Preservative,
Anti-Aging Cream,skincare,Water,7732-18-5,85.2,Vehicle,
Hand Wash Liquid,cleaning,SLES,68585-34-2,12,Surfactant,
Hand Wash Liquid,cleaning,Cocamidopropyl Betaine,61789-40-0,4,Co-surfactant,
Hand Wash Liquid,cleaning,Glycerin,56-81-5,2,Humectant,
Hand Wash Liquid,cleaning,Citric Acid,77-92-9,0.3,pH adjuster,
Hand Wash Liquid,cleaning,Sodium Benzoate,532-32-1,0.3,Preservative,
Hand Wash Liquid,cleaning,Fragrance,N/A,0.5,Fragrance,
Hand Wash Liquid,cleaning,Water,7732-18-5,80.9,Vehicle,
`

type ImportResult = {
  success: boolean
  parsed?: number
  saved?: number
  failed?: number
  warnings?: string[]
  errors?: string[]
  error?: string
}

export default function ImportPage() {
  const { isDark } = useTheme()
  const { user } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'formula-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !user?.id) return
    setBusy(true)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('user_id', user.id)
      const res = await fetch('/api/import-formulas', { method: 'POST', body: fd })
      const data = await res.json()
      setResult(data)
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : 'Import failed',
      })
    } finally {
      setBusy(false)
    }
  }

  const bg = isDark ? 'bg-gray-900' : 'bg-gray-50'
  const heading = isDark ? 'text-white' : 'text-gray-900'
  const sub = isDark ? 'text-gray-400' : 'text-gray-600'
  const card = isDark ? 'bg-white/5 border border-white/5' : 'bg-white border border-gray-200 shadow-sm'
  const dropZone = isDark
    ? 'border-white/20 hover:border-green-400 bg-white/5'
    : 'border-gray-300 hover:border-green-500 bg-gray-50'

  if (!user) {
    return (
      <div className={`min-h-screen p-4 md:p-8 ${bg}`}>
        <div className="max-w-3xl mx-auto">
          <div className={`rounded-2xl p-6 ${card} text-center`}>
            <p className={heading}>Please sign in to import formulas.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`min-h-screen p-4 md:p-8 ${bg}`}>
      <div className="max-w-3xl mx-auto">
        <h1 className={`text-3xl font-bold mb-2 ${heading}`}>Import Formulas from CSV / Excel</h1>
        <p className={`mb-6 ${sub}`}>
          Upload your own formula library. Each row is one component; multiple rows
          with the same Formula Name make one formula.
        </p>

        <div className={`rounded-2xl p-6 mb-6 ${card}`}>
          <div className="flex items-start gap-3 mb-3">
            <FileSpreadsheet className="w-6 h-6 text-green-500 shrink-0 mt-1" />
            <div>
              <h2 className={`font-bold ${heading}`}>Step 1: Get the template</h2>
              <p className={`text-sm mt-1 ${sub}`}>
                Download the CSV template, open it in Excel, fill in your formulas, save as CSV, then upload below.
              </p>
            </div>
          </div>
          <button
            onClick={downloadTemplate}
            className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 text-gray-900 font-bold hover:bg-emerald-400"
          >
            <Download className="w-4 h-4" /> Download CSV Template
          </button>

          <div className={`mt-4 p-3 rounded-lg text-xs font-mono ${isDark ? 'bg-black/30' : 'bg-gray-100'}`}>
            <div className={`font-bold mb-1 ${heading}`}>Required columns:</div>
            <div className={sub}>
              <code>formula_name</code>, <code>component_name</code>, <code>percentage</code>
            </div>
            <div className={`font-bold mb-1 mt-2 ${heading}`}>Optional columns:</div>
            <div className={sub}>
              <code>category</code>, <code>cas_number</code>, <code>function</code>, <code>notes</code>
            </div>
          </div>
        </div>

        <form onSubmit={onSubmit} className={`rounded-2xl p-6 ${card}`}>
          <h2 className={`font-bold mb-3 ${heading}`}>Step 2: Upload your file</h2>
          <label className={`block border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${dropZone}`}>
            <input
              type="file"
              accept=".csv,text/csv,application/vnd.ms-excel"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="hidden"
            />
            <Upload className={`w-12 h-12 mx-auto mb-3 ${isDark ? 'text-gray-400' : 'text-gray-500'}`} />
            <div className={`font-medium ${heading}`}>
              {file ? file.name : 'Click to select a CSV file'}
            </div>
            {file && (
              <div className={`text-sm mt-1 ${sub}`}>{(file.size / 1024).toFixed(1)} KB</div>
            )}
          </label>

          <button
            type="submit"
            disabled={!file || busy}
            className="w-full mt-6 bg-green-500 text-gray-900 py-3 rounded-xl font-bold hover:bg-green-400 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {busy ? 'Importing...' : 'Import Formulas'}
          </button>
        </form>

        {result && (
          <div className={`mt-6 rounded-2xl p-6 ${card}`}>
            {result.success ? (
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-green-500 shrink-0 mt-1" />
                <div className="flex-1">
                  <h2 className={`text-xl font-bold ${heading}`}>
                    {result.saved} formula{result.saved !== 1 ? 's' : ''} imported successfully
                  </h2>
                  <p className={`text-sm mt-1 ${sub}`}>
                    {result.parsed} parsed, {result.saved} saved, {result.failed || 0} failed
                  </p>
                  {result.warnings && result.warnings.length > 0 && (
                    <div className={`mt-3 p-3 rounded-lg text-sm ${isDark ? 'bg-amber-500/10 text-amber-300' : 'bg-amber-100 text-amber-800'}`}>
                      <div className="font-bold mb-1">Warnings:</div>
                      <ul className="list-disc pl-5 space-y-1">
                        {result.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                  )}
                  <a
                    href="/formulas"
                    className="inline-block mt-4 text-green-500 hover:underline text-sm font-bold"
                  >
                    View My Formulas →
                  </a>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <AlertCircle className="w-6 h-6 text-red-500 shrink-0 mt-1" />
                <div className="flex-1">
                  <h2 className={`text-xl font-bold ${heading}`}>Import failed</h2>
                  <p className={`text-sm mt-1 ${sub}`}>{result.error || 'Unknown error'}</p>
                  {result.warnings && result.warnings.length > 0 && (
                    <ul className={`mt-3 list-disc pl-5 text-sm ${sub}`}>
                      {result.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
