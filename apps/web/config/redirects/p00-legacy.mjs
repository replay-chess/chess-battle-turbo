/* global process */
// Phase 0 redirects, moved verbatim out of next.config.js (phase-01 plan 13.3, 1B·J). Pure data plus one env
// read; next.config.js calls ./index.mjs, which concatenates every phase file in order.

/**
 * Base URL of the R2 media bucket (see lib/media.ts), without a trailing slash; "" when unset. next.config.js
 * also uses it for the `images.remotePatterns` host.
 * @param {Record<string, string | undefined>} env
 */
export function mediaUrlOf(env = process.env) {
  return (env.NEXT_PUBLIC_MEDIA_URL ?? "").replace(/\/+$/, "");
}

/** public/ files that redirect to the media bucket, so links from other sites stop pulling bandwidth from Vercel. */
export const MEDIA_PATHS = [
  "/ReplayChessTrailer.mp4",
  "/Kings_Gambit_Chess_Board_Animation.mp4",
  "/video_clip.webm",
  "/sounds/:file*",
];

/**
 * @param {Record<string, string | undefined>} env
 * @returns {import("next/dist/lib/load-custom-routes").Redirect[]}
 */
export function redirects(env = process.env) {
  const mediaUrl = mediaUrlOf(env);
  return [
    {
      source: "/:path*",
      has: [{ type: "host", value: "playchess.tech" }],
      destination: "https://www.playchess.tech/:path*",
      permanent: true,
    },
    // The free guest demo is gone (paid-only, 7-day trial). Keep old links
    // and their search ranking pointing somewhere useful.
    { source: "/try", destination: "/pricing", permanent: true },
    { source: "/try/:path*", destination: "/pricing", permanent: true },
    ...(mediaUrl
      ? MEDIA_PATHS.map((source) => ({
          source,
          destination: `${mediaUrl}${source}`,
          permanent: false,
        }))
      : []),
  ];
}
