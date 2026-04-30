'use client'
import React, { useState } from 'react'

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState('')

  const handleSearch = async () => {
    const res = await fetch(`/api/search?query=${encodeURIComponent(query)}`)
    const data = await res.json()
    setResult(data.results || 'No results found')
  }

  return (
    <div className="min-h-screen bg-gray-900 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">Search Formulas</h1>
        <div className="flex gap-4 mb-8">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search for any formula..."
            className="flex-1 p-4 rounded-xl bg-white/10 text-white text-lg border border-white/10 outline-none"
          />
          <button
            onClick={handleSearch}
            className="bg-green-500 text-gray-900 px-8 py-4 rounded-xl font-bold"
          >
            Search
          </button>
        </div>
        {result && (
          <div className="bg-white/5 rounded-2xl p-6">
            <pre className="text-gray-300 whitespace-pre-wrap">{result}</pre>
          </div>
        )}
      </div>
    </div>
  )
}