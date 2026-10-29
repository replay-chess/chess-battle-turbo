import withPWAInit from "@ducanh2912/next-pwa";
import createMDX from "@next/mdx";
import { withSentryConfig } from "@sentry/nextjs";
import remarkGfm from "remark-gfm";

const withMDX = createMDX({
  extension: /\.mdx?$/,
  options: {
    remarkPlugins: [remarkGfm],
  },
});

const withPWA = withPWAInit({
  dest: "public",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
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
  workboxOptions: {
    disableDevLogs: true,
    exclude: [/\.wasm$/],
  },
});

// Base URL of the R2 media bucket (see lib/media.ts). When set, these public/
// files redirect to the bucket so links from other sites stop pulling
// bandwidth from Vercel.
const MEDIA_URL = (process.env.NEXT_PUBLIC_MEDIA_URL ?? "").replace(/\/+$/, "");
const MEDIA_PATHS = [
  "/ReplayChessTrailer.mp4",
  "/Kings_Gambit_Chess_Board_Animation.mp4",
  "/video_clip.webm",
  "/sounds/:file*",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
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
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "playchess.tech" }],
        destination: "https://www.playchess.tech/:path*",
        permanent: true,
      },
      ...(MEDIA_URL
        ? MEDIA_PATHS.map((source) => ({
            source,
            destination: `${MEDIA_URL}${source}`,
            permanent: false,
          }))
        : []),
    ];
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
