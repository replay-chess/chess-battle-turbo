/* global process */
import withPWAInit from "@ducanh2912/next-pwa";
import createMDX from "@next/mdx";
import prismaWorkaround from "@prisma/nextjs-monorepo-workaround-plugin";
import { withSentryConfig } from "@sentry/nextjs";
import remarkGfm from "remark-gfm";
import { allRedirects, mediaUrlOf } from "./config/redirects/index.mjs";

// Deployed builds must say which environment they are (phase-01 plan 7.9, 10.7.1): flags, test hooks, the
// noindex header and the telemetry tag all read NEXT_PUBLIC_APP_ENV, and unset fails closed at runtime. On
// Vercel an unset or unknown value fails the build instead. Dev branch only; not cherry-picked to main.
const APP_ENVS = ["dev", "test", "production"];
if (process.env.VERCEL === "1" && !APP_ENVS.includes(process.env.NEXT_PUBLIC_APP_ENV ?? "")) {
  throw new Error(
    `NEXT_PUBLIC_APP_ENV must be one of ${APP_ENVS.join(", ")} on Vercel builds (got ${
      process.env.NEXT_PUBLIC_APP_ENV ? JSON.stringify(process.env.NEXT_PUBLIC_APP_ENV) : "unset"
    }). Set it in the project's environment variables.`,
  );
}

// Same rule as lib/auth/route-classes/rules.ts noindexFor(): every build except production is noindex.
const NOINDEX = process.env.NEXT_PUBLIC_APP_ENV?.trim()
  ? process.env.NEXT_PUBLIC_APP_ENV.trim() !== "production"
  : process.env.VERCEL_ENV !== "production";

const withMDX = createMDX({
  extension: /\.mdx?$/,
  options: {
    remarkPlugins: [remarkGfm],
  },
});

// The service worker (phase-01 plan 9.3 H8; optimization plan 4.8; P11 D11 owns the offline shell).
//
// Precache: nothing until P11. A custom `workboxOptions.exclude` REPLACES next-pwa's default excludes (source maps,
// non-preload woff2, manifest*.js); with only [/\.wasm$/] here, 148 `.js.map` entries went into the precache, Sentry
// deletes the maps after its upload, they 404, and every install failed ("bad-precaching-response"): the worker never
// activated and every page load registered it again. The defaults are back, and the keep-list below admits nothing:
// the plan precaches only the offline shell (P11: `/offline`, its chunks, fonts, pieces; budget 600 KB), which does
// not exist yet. Precaching every chunk and public/ file (≈ 10 MB, ≈ 400 requests per visitor and per deploy) is what
// optimization plan 0.1 row 6 removes. scripts/check-sw-precache.mjs checks the built list (CI, after the build).
const PRECACHE_KEEP = []; // RegExps over webpack asset names (e.g. "static/chunks/app/layout-<hash>.js"); P11 fills it

// A route whose fetch fails (network lost, connection reset) with nothing cached answers 504, the way a gateway
// reports an unreachable upstream: the element fails exactly as on a network error (a script's or stylesheet's
// `error` event, a rejected FontFace.load(), `!res.ok` for the engine's fetch) and the browser logs an ordinary
// "Failed to load resource". Without this Workbox throws `no-response`, the rejected respondWith reaches the page,
// and WebKit reports it there as uncaught errors per request ("no-response :: [{url: …woff2}]" and
// "/localhost:…/x.woff2.", CI run 43246907343). Response.error() is no better on WebKit: it logs "Response served by
// service worker is an error" and "Cannot load ." as JavaScript errors. The function is copied into sw.js as source,
// so it uses nothing from this file.
const NETWORK_ERROR_ON_FAILURE = {
  handlerDidError: async () =>
    new Response(null, { status: 504, statusText: "Gateway Timeout", headers: { "x-rc-sw": "network-error" } }),
};

const withPWA = withPWAInit({
  dest: "public",
  // The service worker never caches signed-in HTML, RSC payloads or /api/*
  // responses: those are per-user documents (phase-01 plan 9.3 H8, 11.3).
  cacheOnFrontEndNav: false,
  aggressiveFrontEndNavCaching: false,
  // The online chip replaces the reload (SPEC D18).
  reloadOnOnline: false,
  disable: process.env.NODE_ENV === "development",
  // Registration is ours (app/components/ServiceWorkerRegistration.tsx, lib/pwa/registerServiceWorker.ts): the
  // plugin's `window.workbox.register()` left its promise unhandled, so a navigation that cancelled the sw.js load
  // (WebKit: "SecurityError: Script …/sw.js load failed") surfaced as an uncaught page error.
  register: false,
  // No public/ file is precached (see PRECACHE_KEEP above); they load, and runtime-cache, when a page uses them.
  publicExcludes: ["!**/*"],
  // The plugin's "start-url" route is a NetworkFirst cache of `/` registered
  // ahead of everything else (dynamicStartUrl prepends it; cacheStartUrl would
  // precache it); `/` renders per-user chrome, so both are off.
  cacheStartUrl: false,
  dynamicStartUrl: false,
  // Only the routes below; none of the plugin's defaults. Their catch-alls ("apis", "pages", "pages-rsc*",
  // "cross-origin") are NetworkFirst caches that store 200s whatever the Cache-Control. Every rule here matches a
  // static asset by its request destination and path, so a document (any navigation), a fetch/XHR (destination "",
  // RSC and /api/* included), a socket.io poll and anything else unlisted gets no route at all: the worker does not
  // answer it and the browser loads it exactly as without a service worker (phase-01 plan 9.3: the SW never stores
  // authenticated JSON or HTML). Each urlPattern is copied into sw.js as source, so it may use nothing from this
  // file. scripts/check-sw-routes.mjs checks the built sw.js (CI, after the build).
  extendDefaultRuntimeCaching: false,
  workboxOptions: {
    disableDevLogs: true,
    // A new deploy's worker takes over at once (next-pwa's defaults, stated): it holds no documents and no
    // precache, so nothing an open page relies on changes under it; the page moves to the new build on its next
    // document load, which always comes from the network.
    skipWaiting: true,
    clientsClaim: true,
    exclude: [
      // next-pwa's defaults (a custom list replaces them): source maps (deleted after the Sentry upload), fonts
      // the page does not preload, build manifests.
      /\/_next\/static\/.*(?<!\.p)\.woff2/,
      /\.map$/,
      /^manifest.*\.js$/,
      // The 7 MB engine: runtime-cached by its hashed folder (rc-engine-v18) when a bot game needs it.
      /\.wasm$/,
      ({ asset }) => !PRECACHE_KEEP.some((re) => re.test(asset.name)),
    ],
    runtimeCaching: [
      {
        // The engine (P2 plan 9.3): the hashed same-origin folder and R2's /engine/sf18-<hash>/ are immutable, so
        // cache-first. The worker fetches the wasm with destination "", so this rule is not limited by destination.
        urlPattern: ({ url }) => /\/sf18-[0-9a-f]{12}\//.test(url.pathname),
        handler: "CacheFirst",
        options: {
          cacheName: "rc-engine-v18",
          plugins: [NETWORK_ERROR_ON_FAILURE],
          expiration: { maxEntries: 10 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
      {
        // Next's hashed build output (optimization plan 4.8: runtime only, max 200 entries).
        urlPattern: ({ request, url, sameOrigin }) =>
          sameOrigin &&
          url.pathname.startsWith("/_next/static/") &&
          ["script", "style", "font", "worker"].includes(request.destination),
        handler: "CacheFirst",
        options: {
          cacheName: "next-static",
          plugins: [NETWORK_ERROR_ON_FAILURE],
          expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
          cacheableResponse: { statuses: [200] },
        },
      },
      {
        urlPattern: ({ request, url, sameOrigin }) =>
          sameOrigin && request.destination === "image" && url.pathname === "/_next/image",
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "next-image",
          plugins: [NETWORK_ERROR_ON_FAILURE],
          expiration: { maxEntries: 64, maxAgeSeconds: 24 * 60 * 60 },
          cacheableResponse: { statuses: [200] },
        },
      },
      {
        // Image files from public/ (and their R2 redirects). Not /api/* or /og/*: generated images can be private
        // or revoked (share pages).
        urlPattern: ({ request, url, sameOrigin }) =>
          sameOrigin &&
          request.destination === "image" &&
          /\.(?:png|jpe?g|gif|svg|webp|avif|ico)$/i.test(url.pathname) &&
          !url.pathname.startsWith("/api/") &&
          !url.pathname.startsWith("/og/"),
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "static-image-assets",
          plugins: [NETWORK_ERROR_ON_FAILURE],
          expiration: { maxEntries: 64, maxAgeSeconds: 30 * 24 * 60 * 60 },
          cacheableResponse: { statuses: [200] },
        },
      },
      {
        urlPattern: ({ request, url }) => request.destination === "font" && url.hostname === "fonts.gstatic.com",
        handler: "CacheFirst",
        options: {
          cacheName: "google-fonts-webfonts",
          plugins: [NETWORK_ERROR_ON_FAILURE],
          expiration: { maxEntries: 4, maxAgeSeconds: 365 * 24 * 60 * 60 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
    ],
  },
});

// Base URL of the R2 media bucket (see lib/media.ts). Its host is allowed for
// next/image; the public/ media redirects live in config/redirects/p00-legacy.mjs.
const MEDIA_URL = mediaUrlOf(process.env);
const MEDIA_HOST = (() => {
  try {
    return MEDIA_URL ? new URL(MEDIA_URL).hostname : null;
  } catch {
    return null;
  }
})();

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
  // The devices build uses .next-devices so it never fights `next dev` (SPEC 5.2).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Bundle attribution (scripts/bundle-breakdown.mjs): browser source maps only when asked for, never in CI/prod builds.
  productionBrowserSourceMaps: process.env.NEXT_BUNDLE_SOURCEMAPS === "1",
  devIndicators: process.env.NEXT_PUBLIC_DEV_WIDGETS === "0" ? false : undefined,
  // Workspace packages ship TypeScript source (phase-01 plan 7.3, 10.1; phase-02 plan 6.9).
  transpilePackages: ["@repo/contracts", "@repo/analytics", "@repo/db", "@repo/game-core", "@repo/chess-analysis"],
  // The Prisma client is generated into packages/db/generated/prisma (phase-02 plan 6.9). File tracing follows the
  // client's own path.join(__dirname, ...) annotations, but this keeps the query engines (darwin locally,
  // rhel-openssl on Vercel, linux-musl in Docker) and schema.prisma in every server bundle even if a bundler
  // change hides them (risk R-02).
  outputFileTracingIncludes: {
    "/**": ["../../packages/db/generated/prisma/*.node", "../../packages/db/generated/prisma/schema.prisma"],
  },
  // The client is bundled into the server chunks, where Prisma looks for schema.prisma and the engine next to the
  // chunk (__dirname) or under the runtime cwd; neither is packages/db on Vercel (/var/task). Prisma's monorepo
  // plugin copies both next to every chunk that holds the client (https://pris.ly/d/engine-not-found-nextjs).
  webpack(config, { isServer }) {
    if (isServer) config.plugins.push(new prismaWorkaround.PrismaPlugin());
    return config;
  },
  // Only use standalone output for Docker builds
  // Amplify uses standard Next.js output
  ...(process.env.USE_STANDALONE === "true" && { output: "standalone" }),
  experimental: {
    reactCompiler: true,
  },
  // PostHog is proxied through /ingest so ad blockers don't drop events
  // (https://posthog.com/docs/advanced/proxy/nextjs)
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  // Allow-list only (phase-01 plan 9.3 H12): "**" made /_next/image an open
  // proxy against the image quota. Avatars and legend portraits come from
  // hosts we don't control, so those call sites render `unoptimized`.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "img.clerk.com" },
      { protocol: "https", hostname: "images.clerk.dev" },
      { protocol: "https", hostname: "images.chesscomfiles.com" },
      ...(MEDIA_HOST ? [{ protocol: "https", hostname: MEDIA_HOST }] : []),
    ],
  },
  // One file per phase in config/redirects/ (registries as directories, plan 13.3 1B·J).
  async redirects() {
    return allRedirects(process.env);
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      // Images — cache 1 month
      {
        source: "/:path*.(ico|jpg|jpeg|png|gif|svg|webp)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=2592000, stale-while-revalidate=86400",
          },
        ],
      },
      // Fonts — cache 1 month
      {
        source: "/:path*.(woff|woff2|ttf|otf|eot)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=2592000, stale-while-revalidate=86400",
          },
        ],
      },
      // Videos/media — cache 1 month
      {
        source: "/:path*.(mp4|webm)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=2592000, stale-while-revalidate=86400",
          },
        ],
      },
      // Workers (Stockfish WASM + JS) — no cache (prevent stale WASM/JS mismatch)
      {
        source: "/workers/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
      // Hashed engine folders (/workers/sf18-<hash>/, phase-02 plan 0.2 and WP-H): the hash changes with the
      // files, so they are immutable. Listed after the rule above so its Cache-Control wins for these paths.
      {
        source: "/workers/sf18-:hash/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      // Service worker + manifest — no cache (need immediate updates)
      {
        source: "/(sw.js|manifest.json)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
      // Public review shares (phase-03 plan §4.4, §11.3, AP-14): opt-in links, never indexed on any environment. The
      // page also sets `robots` metadata; the header covers the image route and any crawler that skips the HTML.
      // `Referrer-Policy: no-referrer`: the code is a bearer capability, so a link followed from the page (Pricing,
      // the trial) or an asset it loads never carries it to the next site or into its analytics (FIX-2).
      {
        source: "/r/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      // Non-production builds are never indexed (P1-17, SEC-3). The middleware sets this header on everything it
      // handles; these are the API routes its matcher skips (they never run Clerk), so they get it here instead,
      // with the same value as lib/auth/route-classes/rules.ts ROBOTS_VALUE.
      ...(NOINDEX
        ? ["/api/health", "/api/health/:path*", "/api/openings", "/api/webhook/:path*", "/api/cron/:path*"].map(
            (source) => ({ source, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }),
          )
        : []),
    ];
  },
};

export default withSentryConfig(withMDX(withPWA(nextConfig)), {
  org: "replay-chess-uf",
  project: "replay-chess-web",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  automaticVercelMonitors: true,
  // Keep the client maps of an attribution build (NEXT_BUNDLE_SOURCEMAPS=1); every other build keeps Sentry's default.
  ...(process.env.NEXT_BUNDLE_SOURCEMAPS === "1" && { sourcemaps: { deleteSourcemapsAfterUpload: false } }),
});
