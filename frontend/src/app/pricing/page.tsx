'use client'
import React from 'react'
import { Check } from 'lucide-react'

const plans = [
  { name: 'Starter', price: 0, features: ['10 formulas/month', 'Basic search', 'PDF export'], highlight: false },
  { name: 'Professional', price: 49, features: ['100 formulas/month', 'Advanced AI', 'API access'], highlight: true },
  { name: 'Business', price: 299, features: ['Unlimited formulas', 'Team access', '24/7 support'], highlight: false },
  { name: 'Enterprise', price: 999, features: ['Everything', 'On-premise', 'Custom dev'], highlight: false }
]

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-gray-900 py-20">
      <div className="max-w-6xl mx-auto px-4">
        <h1 className="text-4xl font-bold text-white text-center mb-12">Pricing Plans</h1>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => {
            const cardClass = plan.highlight ? 'bg-green-800 ring-4 ring-green-400 scale-105' : 'bg-white/10'
            const btnClass = plan.highlight ? 'bg-white text-green-700' : 'bg-white/20 text-white'
            return (
              <div key={plan.name} className={'rounded-2xl p-6 ' + cardClass}>
                {plan.highlight && <span className="absolute -top-3 right-4 bg-yellow-400 text-gray-900 px-3 py-1 rounded-full text-sm font-bold">Popular</span>}
                <h3 className="text-xl font-bold text-white mb-2">{plan.name}</h3>
                <div className="mb-6"><span className="text-4xl font-bold text-white"></span><span className="text-gray-400">/mo</span></div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-gray-300 text-sm"><Check className="w-4 h-4 text-green-400 mt-0.5" />{f}</li>
                  ))}
                </ul>
                <button className={'w-full py-3 rounded-xl font-bold ' + btnClass}>{plan.price === 0 ? 'Start Free' : 'Subscribe'}</button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
