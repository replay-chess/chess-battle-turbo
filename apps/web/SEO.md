# ReplayChess SEO operations

## Google Search Console setup

1. Create a **Domain property** for `playchess.tech` in Google Search Console.
2. Add the supplied DNS TXT verification record at the domain's DNS provider.
3. After verification, submit `https://www.playchess.tech/sitemap.xml`.
4. Inspect and request indexing for:
   - `https://www.playchess.tech/`
   - `https://www.playchess.tech/try`
   - `https://www.playchess.tech/blog`
   - one published category URL
   - each newly published article URL
5. Check the Pages, Core Web Vitals, and Article enhancement reports after Google recrawls the site.

DNS verification and sitemap submission are deployment-owner actions; they do not require a verification meta tag in the app.

## Release checks

- `pnpm --filter web check-types`
- `pnpm --filter web build`
- Start the built app or development server, then run `pnpm --filter web test:seo`
- Validate one article with Google's Rich Results Test.
- Confirm every URL in `/sitemap.xml` returns `200`, is self-canonical, and is indexable.

The automated SEO check covers published/draft separation, metadata, canonicals, Article schema, RSS, category indexing, sitemap inclusions, and known sitemap regressions.

## Production-domain checks

- Keep `https://www.playchess.tech` as the only canonical origin.
- Configure the hosting platform to send a permanent `308` redirect from `https://playchess.tech/*` to the matching `www` URL. The app has the same redirect, but the platform-level domain redirect takes precedence in production.
- After each release, verify both hosts with `curl -I` and confirm there is only one redirect hop.
- Measure the homepage, `/try`, `/blog`, and a representative article with PageSpeed Insights or Chrome DevTools against production. Record LCP, INP, and CLS before treating performance work as complete.
