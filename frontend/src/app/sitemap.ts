import type { MetadataRoute } from 'next'

const SITE = process.env.NEXT_PUBLIC_APP_URL || 'https://jamilformula.com'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return [
    { url: `${SITE}/`,         lastModified: now, changeFrequency: 'weekly',  priority: 1.0 },
    { url: `${SITE}/search`,   lastModified: now, changeFrequency: 'daily',   priority: 0.9 },
    { url: `${SITE}/upload`,   lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE}/pricing`,  lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE}/login`,    lastModified: now, changeFrequency: 'yearly',  priority: 0.5 },
    { url: `${SITE}/register`, lastModified: now, changeFrequency: 'yearly',  priority: 0.5 },
  ]
}
