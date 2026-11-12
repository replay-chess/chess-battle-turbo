// The public share page `/r/<code>` (phase-03 plan §4.4, §5.5, §11.3; AP-05, AP-14, AP-47; G5 Lighthouse ≥ 95).
//
// A route handler that answers one plain HTML document (html.ts): no React, no Next client runtime, no root layout.
// As an App Router page it shipped the root layout's JS (Clerk, the query client, the toaster, the analytics and PWA
// islands: ~265 kB gzipped) to a page that needs none of it, and Lighthouse held it at 83–86 (FIX-2). The document
// carries its own stylesheet (share-css.ts) and one ≤ 6 kB script, the stepper island (island.ts).
//
// Caching, as the page had it: `force-static` with `revalidate = 3600` and no prerendered codes renders a code on its
// first visit and serves that render for an hour (an expired link shows `gone` within the hour); an unknown code's
// 404 is cached the same way, so probing random codes costs at most one render per code per hour. A11 (PATCH and
// DELETE) purges a link at once with `revalidateTag("share:<code>")`: the tag is on the one data loader,
// `loadPublicShare`. No `headers()`, `cookies()` or flags (any of them would turn the cache off); `noindex, nofollow`
// in the document and as the `X-Robots-Tag` header, and `Referrer-Policy: no-referrer` (next.config.js).
//
// It reads only the frozen snapshot (masked names, moves, grades, accuracy, the card moment, the summary): no refs,
// no clocks, no ids.
import { after } from "next/server";
import { shareImagePath } from "@repo/contracts/http/share";
import { loadPublicShare } from "@/lib/data/share";
import { isTestBuild } from "@/lib/env";
import { siteOrigin } from "@/lib/routes";
import { ANONYMOUS_SERVER_DISTINCT_ID, captureReviewServerEvent } from "@/lib/services/analysis/telemetry";
import { noticePage, sharePage } from "./html";
import { shareViewOf } from "./share-view";

// `revalidate` must be a literal for Next's static analysis; it equals SHARE_REVALIDATE_SEC (checked by route.test.ts).
export const revalidate = 3600;
export const dynamic = "force-static";
export const dynamicParams = true;

export function generateStaticParams(): { code: string }[] {
  return [];
}

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" } as const;

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  const { code } = await params;
  const share = await loadPublicShare(code);
  if (share.state === "not_found") return new Response(noticePage("not_found"), { status: 404, headers: HTML_HEADERS });
  // The App Router could not answer 410 for a page; the API surfaces do (plan §4.4). The page keeps 200 + noindex.
  if (share.state === "gone") return new Response(noticePage("gone"), { status: 200, headers: HTML_HEADERS });
  // A render (first visit, then at most hourly): the referrer and the session are unknown here, the island's beacon
  // reports those (plan §10.1). Never the code as the distinct id: it is the link itself (a bearer capability).
  after(() =>
    captureReviewServerEvent("share_page_viewed", { referrer_domain: "none", signed_in: false }, ANONYMOUS_SERVER_DISTINCT_ID),
  );
  const html = sharePage(shareViewOf(share.snapshot), {
    image: `${siteOrigin()}${shareImagePath(code, share.imageVersion)}`,
    island: {
      sink: process.env.NEXT_PUBLIC_TELEMETRY_SINK === "1" && isTestBuild(),
      posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY || null,
      appEnv: process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || "development",
    },
  });
  return new Response(html, { status: 200, headers: HTML_HEADERS });
}
