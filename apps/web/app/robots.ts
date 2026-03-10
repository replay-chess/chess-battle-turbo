import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/admin/',
        '/queue',
        '/onboarding',
        '/sign-in',
        '/sentry-example-page',
        '/game/',
        '/analysis/',
        '/join/',
      ],
    },
    sitemap: 'https://www.playchess.tech/sitemap.xml',
  }
}
