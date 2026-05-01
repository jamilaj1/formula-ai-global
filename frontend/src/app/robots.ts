import type { MetadataRoute } from 'next'

const SITE = process.env.NEXT_PUBLIC_APP_URL || 'https://jamilformula.com'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/dashboard', '/history', '/formulas'],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  }
}
