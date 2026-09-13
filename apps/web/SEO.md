# ReplayChess SEO operations

## Google Search Console setup

1. Create a **Domain property** for `playchess.tech` in Google Search Console.
2. Add the supplied DNS TXT verification record at the domain's DNS provider.
3. After verification, submit all three sitemaps (one per catalogue so the Pages report shows indexation per catalogue):
   - `https://www.playchess.tech/sitemap.xml` (static pages + blog)
   - `https://www.playchess.tech/sitemap-legends.xml`
   - `https://www.playchess.tech/sitemap-openings.xml`
4. Inspect and request indexing for:
   - `https://www.playchess.tech/`
   - `https://www.playchess.tech/try`
   - `https://www.playchess.tech/blog`
   - `https://www.playchess.tech/legends` and `https://www.playchess.tech/openings`
   - one published category URL
   - each newly published article URL
   - a handful of legend and opening detail URLs (Google finds the rest through the sitemaps and internal links)
5. Check the Pages, Core Web Vitals, and Article enhancement reports after Google recrawls the site.
6. Add the same domain property to Bing Webmaster Tools (it can import the GSC property in one click).

DNS verification and sitemap submission are deployment-owner actions; they do not require a verification meta tag in the app.

## Catalogue pages are public on purpose

`/openings/*` and `/legends/*` are readable without an account and indexable — they are the site's
main organic surface (~3,700 pages). Only the play actions (`/play`, `/position`, game-creation APIs)
are auth-gated. Do not add them back to `isProtectedRoute` in `middleware.ts` or set `noIndex` on their
layouts; `pnpm --filter web test:seo` fails if either regresses.

Scraping mitigation belongs in the Vercel Firewall, not in auth: add a rate-limit rule on
`/openings/*` and `/legends/*` (e.g. 120 requests / 60 s per IP, challenge on excess) and keep the
narrated-explanation audio behind signed URLs.

## IndexNow (Bing, Yandex, Seznam, Naver)

Google ignores IndexNow; everyone else uses it. The key file is `public/<key>.txt` and
`.github/workflows/indexnow.yml` runs `scripts/indexnow.mjs` daily, submitting every sitemap URL whose
`<lastmod>` is within the last two days. After a large content change, run the workflow manually with
`scope=all` (or `pnpm --filter web indexnow --scope all` locally) to resubmit everything once.

## Release checks

- `pnpm --filter web check-types`
- `pnpm --filter web build`
- Start the built app or development server, then run `pnpm --filter web test:seo`
- Validate one article with Google's Rich Results Test.
- Confirm every URL in `/sitemap.xml` returns `200`, is self-canonical, and is indexable.

The automated SEO check covers published/draft separation, metadata, canonicals, Article schema, RSS, category indexing, sitemap inclusions, and known sitemap regressions.

## Production-domain checks

- Keep `https://www.playchess.tech` as the only canonical origin.
- Configure the hosting platform to send a permanent `308` redirect from `https://playchess.tech/*` to the matching `www` URL. The app has the same redirect, but the platform-level domain redirect takes precedence in production. As of 2026-09-13 Vercel serves a `307` here — fix it in Vercel → Project → Settings → Domains → `playchess.tech` → Redirect to `www.playchess.tech` → **308 Permanent**.
- After each release, verify both hosts with `curl -I` and confirm there is only one redirect hop.
- Measure the homepage, `/try`, `/blog`, and a representative article with PageSpeed Insights or Chrome DevTools against production. Record LCP, INP, and CLS before treating performance work as complete.
