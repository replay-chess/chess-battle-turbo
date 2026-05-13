import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

// Scraper routes use API key authentication instead of Clerk
const isScraperRoute = createRouteMatcher(['/api/scraper(.*)'])
// Dodo webhooks use HMAC signature verification, not Clerk
const isDodoWebhookRoute = createRouteMatcher(['/api/webhook/dodo-payments(.*)'])
// Routes requiring authentication: anti-scraping pages + app pages that
// previously relied on client-side useRequireAuth() (which caused a flash
// of content/loading-skeleton before redirect). Gating at middleware
// redirects unauthenticated users at the edge before any HTML/JS ships.
const isProtectedRoute = createRouteMatcher([
  '/openings(.*)',
  '/legends(.*)',
  '/play(.*)',
  '/game(.*)',
  '/queue(.*)',
  '/challenge(.*)',
  '/join(.*)',
  '/join-tournament(.*)',
  '/analysis(.*)',
  '/tournament(.*)',
  '/position(.*)',
])

export default clerkMiddleware(async (auth, req) => {
  if (isScraperRoute(req) || isDodoWebhookRoute(req)) {
    return
  }
  if (isProtectedRoute(req)) {
    const { userId, redirectToSignIn } = await auth()
    if (!userId) {
      return redirectToSignIn({ returnBackUrl: req.url })
    }
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