# SEO Playbook — ReplayChess

How we drive organic search traffic to https://www.playchess.tech, what is
already implemented in code, and the recurring manual work that code cannot do.

## The model

Ranking = **indexable** × **relevant** × **trusted**. Any factor at zero makes
the product zero. Our technical layer (metadata, sitemap, JSON-LD, OG images,
RSS) was already strong; the historical bottleneck was *relevant* — almost no
indexable content, because the opening and legend databases were auth-gated.

## What is implemented in code

- **Public opening reference pages** — `/learn/openings/[slug]` (one URL per
  named opening, canonical shortest line, alternative move orders listed) and
  `/learn/openings/eco/[a-e]` family directories. Server-rendered, no auth, no
  client JS board. The interactive training product (`/openings`, `/play`) and
  the raw APIs stay gated — we expose reference *content*, not the database.
- **Public legend bio pages** — `/learn/legends/[slug]` with Person JSON-LD,
  achievements, famous-game positions. Challenging the legend stays gated.
- **Sitemap** — `app/sitemap.ts` includes all of the above; database-backed
  entries fail soft so a build without DB access still emits the static pages.
- **Search Console / Bing verification** — set `GOOGLE_SITE_VERIFICATION` and
  `BING_SITE_VERIFICATION` env vars (meta-tag tokens) and redeploy, or verify
  via DNS instead. Wired in `apps/web/app/layout.tsx`.
- Existing foundation: per-page canonicals + OG/Twitter via
  `apps/web/lib/seo.ts`, Organization/Article JSON-LD, dynamic OG images at
  `/og`, RSS at `/blog/rss.xml`, author + editorial-policy pages.

## Manual setup (one-time, ~30 minutes)

1. **Google Search Console**: verify `playchess.tech` (DNS TXT record is the
   most durable method), then submit `https://www.playchess.tech/sitemap.xml`.
2. **Bing Webmaster Tools**: import the verified GSC property (one click).
3. After the next deploy, spot-check indexability: `site:playchess.tech` and
   the URL Inspection tool on a few `/learn/openings/...` pages.

## Recurring work (the part that actually compounds)

### Content cadence — 1–2 posts/week
The existing posts (famous game + Stockfish analysis + a teachable idea) are
the right template. Target **long-tail queries** ("why did Kasparov sacrifice
the knight on f6"), not head terms ("chess strategy") — we will not outrank
chess.com for head terms, but we can own hundreds of specific ones. Every post
must follow the editorial policy: real engine output, cited game sources.

### Links — the only channel you can't code
- Post each analysis to r/chess with the position as the hook (not a link dump).
- Answer Chess Stack Exchange questions where an analysis genuinely helps.
- Get listed in "chess training tools" roundups and awesome-lists.
- Ten links from real chess sites beat a thousand directory submissions.

### Internal linking hygiene
When writing a blog post, link opening names to their
`/learn/openings/[slug]` page and player names to `/learn/legends/[slug]`.
This is how authority flows from posts to the reference database.

## Measurement

- **Weeks 2–4**: GSC *impressions* rise — proof of indexing. This is the first
  signal; do not judge by clicks yet.
- **Months 2–3**: clicks begin on long-tail queries. Check GSC's "queries with
  impressions but position > 10" — those pages need content deepening.
- **Ongoing**: watch Core Web Vitals in GSC (Speed Insights is already wired).
- The failure mode is quitting at week six. SEO compounds slowly, then all at
  once.

## Guardrails

- Never `noindex` or robots-disallow the `/learn` tree.
- Don't mass-generate thin pages beyond what the database's real content
  supports; quality penalties are site-wide.
- Keep gated app URLs (`/openings`, `/legends`, `/game`, ...) out of the
  sitemap and disallowed in `app/robots.ts` — send crawlers to `/learn`.
