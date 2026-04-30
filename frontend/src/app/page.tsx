'use client'
import React from 'react'
import { Globe, Beaker, Shield, Zap } from 'lucide-react'

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900">
      <nav className="flex items-center justify-between px-8 py-4">
        <div className="text-white text-2xl font-bold">
          Formula <span className="text-green-400">AI</span>
        </div>
        <div className="flex gap-4">
          <a href="/login" className="text-white hover:text-green-400">Login</a>
          <a href="/pricing" className="bg-green-500 text-gray-900 px-4 py-2 rounded-lg font-bold">Get Started</a>
        </div>
      </nav>
      <div className="max-w-6xl mx-auto px-4 py-20 text-center">
        <h1 className="text-6xl font-bold text-white mb-6">
          World First
          <span className="text-green-400"> AI-Powered </span>
          Chemical Formulation Platform
        </h1>
        <p className="text-xl text-gray-300 mb-8">200000+ Formulas | 40 Industries | 195 Countries | 20 Languages</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
          <div className="bg-white/10 rounded-xl p-6"><Globe className="w-8 h-8 text-green-400 mx-auto mb-2" /><div className="text-2xl font-bold text-white">195</div><div className="text-sm text-gray-400">Countries</div></div>
          <div className="bg-white/10 rounded-xl p-6"><Beaker className="w-8 h-8 text-green-400 mx-auto mb-2" /><div className="text-2xl font-bold text-white">200K+</div><div className="text-sm text-gray-400">Formulas</div></div>
          <div className="bg-white/10 rounded-xl p-6"><Shield className="w-8 h-8 text-green-400 mx-auto mb-2" /><div className="text-2xl font-bold text-white">40</div><div className="text-sm text-gray-400">Industries</div></div>
          <div className="bg-white/10 rounded-xl p-6"><Zap className="w-8 h-8 text-green-400 mx-auto mb-2" /><div className="text-2xl font-bold text-white">AI</div><div className="text-sm text-gray-400">Powered</div></div>
        </div>
        <div className="flex gap-4 justify-center">
          <a href="/search" className="bg-green-500 text-gray-900 px-8 py-4 rounded-xl text-lg font-bold">Try Search</a>
          <a href="/pricing" className="bg-white/10 text-white px-8 py-4 rounded-xl text-lg font-bold">View Plans</a>
        </div>
      </div>
    </main>
  )
}
