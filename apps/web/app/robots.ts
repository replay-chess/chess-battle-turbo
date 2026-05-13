import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
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
          '/openings/',
          '/legends/',
        ],
      },
      // Explicitly allow AI search engine bots to crawl public content
      {
        userAgent: [
          'GPTBot',
          'ChatGPT-User',
          'Google-Extended',
          'PerplexityBot',
          'ClaudeBot',
          'Applebot-Extended',
          'anthropic-ai',
        ],
        allow: [
          '/',
          '/blog/',
          '/pricing',
          '/about',
          '/help',
        ],
        disallow: ['/api/', '/admin/', '/game/', '/analysis/', '/join/', '/openings/', '/legends/'],
      },
    ],
    sitemap: 'https://www.playchess.tech/sitemap.xml',
  }
}
