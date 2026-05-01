'use client'
import React from 'react'
import { useTheme } from '@/components/providers/ThemeProvider'
import { useLanguage } from '@/components/providers/LanguageProvider'

const plans = [
  { name: 'Starter', price: '0', features: ['10 formulas/month', 'Basic search', 'PDF export'] },
  { name: 'Professional', price: '49', features: ['100 formulas/month', 'Advanced AI', 'API access'], popular: true },
  { name: 'Business', price: '299', features: ['Unlimited formulas', 'Team access', '24/7 support'] },
  { name: 'Enterprise', price: '999', features: ['Everything', 'On-premise', 'Custom dev'] },
]

export default function PricingPage() {
  const { isDark } = useTheme()
  const { t } = useLanguage()

  const bg = isDark ? 'bg-gray-900' : 'bg-gray-50'
  const heading = isDark ? 'text-white' : 'text-gray-900'

  return (
    <div className={`min-h-screen py-20 ${bg}`}>
      <div className="max-w-6xl mx-auto px-4">
        <h1 className={`text-4xl font-bold text-center mb-12 ${heading}`}>{t('pricing')}</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map((plan) => {
            const cardBase = 'relative rounded-2xl p-6 transition-transform'
            const cardStyle = plan.popular
              ? 'bg-green-700 ring-4 ring-green-400 md:scale-105 text-white'
              : isDark
                ? 'bg-white/10 text-white'
                : 'bg-white border border-gray-200 text-gray-900 shadow-sm'
            const featureColor = plan.popular ? 'text-green-50' : isDark ? 'text-gray-300' : 'text-gray-700'
            const monthColor = plan.popular ? 'text-green-100' : isDark ? 'text-gray-400' : 'text-gray-500'
            const btnStyle = plan.popular
              ? 'bg-white text-green-700 hover:bg-gray-100'
              : isDark
                ? 'bg-white/20 text-white hover:bg-white/30'
                : 'bg-gray-900 text-white hover:bg-gray-800'

            return (
              <div key={plan.name} className={`${cardBase} ${cardStyle}`}>
                {plan.popular && (
                  <span className="absolute -top-3 right-4 bg-yellow-400 text-gray-900 px-3 py-1 rounded-full text-sm font-bold">
                    Popular
                  </span>
                )}
                <h3 className="text-xl font-bold mb-2">{plan.name}</h3>
                <div className="mb-6">
                  <span className="text-4xl font-bold">${plan.price}</span>
                  <span className={monthColor}>/month</span>
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((f, i) => (
                    <li key={i} className={`flex items-center gap-2 text-sm ${featureColor}`}>
                      <span className="text-green-400">YES</span> {f}
                    </li>
                  ))}
                </ul>
                <button className={`w-full py-3 rounded-xl font-bold ${btnStyle}`}>
                  {plan.price === '0' ? 'Start Free' : 'Subscribe'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
