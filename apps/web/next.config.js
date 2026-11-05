/* global process */
import withPWAInit from "@ducanh2912/next-pwa";
import createMDX from "@next/mdx";
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

const withPWA = withPWAInit({
  dest: "public",
  // The service worker never caches signed-in HTML, RSC payloads or /api/*
  // responses: those are per-user documents (phase-01 plan 9.3 H8, 11.3).
  cacheOnFrontEndNav: false,
  aggressiveFrontEndNavCaching: false,
  // The online chip replaces the reload (SPEC D18).
  reloadOnOnline: false,
  disable: process.env.NODE_ENV === "development",
  // Every public/ file is precached unless excluded here, so each install
  // downloaded ~90 MB of media most visitors never open. These still load
  // normally when a page uses them.
  publicExcludes: [
    "!noprecache/**/*",
    "!**/*.{gif,mp4,webm,map}",
    "!sounds/**/*",
    "!workers/**/*.wasm",
    "!rohit-pandit.jpeg",
    "!chess_logo_share.png",
    "!mobile_icon_perfect.png",
  ],
  // The plugin's "start-url" route is a NetworkFirst cache of `/` registered
  // ahead of everything else (dynamicStartUrl prepends it; cacheStartUrl would
  // precache it); `/` renders per-user chrome, so both are off.
  cacheStartUrl: false,
  dynamicStartUrl: false,
  // Our NetworkOnly routes go first, then the plugin's static-asset defaults.
  // Workbox uses the first matching route, so documents (any navigation),
  // fetch/XHR calls (same- or cross-origin, e.g. Clerk's /v1/client JSON),
  // /api/* and RSC requests never reach the default "apis", "pages",
  // "pages-rsc*" or "cross-origin" NetworkFirst caches, which store 200s
  // whatever their Cache-Control (phase-01 plan 9.3: the SW never stores
  // authenticated JSON or HTML). Images, fonts, scripts, styles and media
  // keep the defaults. test/pwa/sw-routes.test.ts checks the built sw.js.
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    disableDevLogs: true,
    exclude: [/\.wasm$/],
    runtimeCaching: [
      {
        urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
        handler: "NetworkOnly",
      },
      {
        urlPattern: ({ request, url }) =>
          request.headers.get("RSC") === "1" || url.searchParams.has("_rsc"),
        handler: "NetworkOnly",
      },
      {
        urlPattern: ({ request }) => request.mode === "navigate" || request.destination === "document",
        handler: "NetworkOnly",
      },
      {
        urlPattern: ({ request }) => request.destination === "",
        handler: "NetworkOnly",
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
  devIndicators: process.env.NEXT_PUBLIC_DEV_WIDGETS === "0" ? false : undefined,
  // Workspace packages ship TypeScript source (phase-01 plan 7.3, 10.1).
  transpilePackages: ["@repo/contracts", "@repo/analytics"],
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
});
