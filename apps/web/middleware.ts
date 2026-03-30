import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Scraper routes use API key authentication instead of Clerk
const isScraperRoute = createRouteMatcher(['/api/scraper(.*)'])
// Dodo webhooks use HMAC signature verification, not Clerk
const isDodoWebhookRoute = createRouteMatcher(['/api/webhook/dodo-payments(.*)'])
// Openings pages require authentication (anti-scraping)
const isProtectedRoute = createRouteMatcher(['/openings(.*)'])

export default clerkMiddleware(async (auth, req) => {
  if (isScraperRoute(req) || isDodoWebhookRoute(req)) {
    return
  }
  if (isProtectedRoute(req)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    // Skip Next.js internals, static files, and PWA service worker files
    '/((?!_next|sw\\.js|workbox-.*|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}