// Middleware (plan phase-01 §7.6, P1-11). The code is frozen after Phase 1: routes change class through data files in
// lib/auth/route-classes/ (one per phase), never here.
//
// Order, cheapest first:
//   1. scanner probe → 404, nothing else (no Clerk; only X-Robots-Tag off production);
//   2. x-request-id / x-mw-start / x-rc-pathname on the forwarded request; X-Robots-Tag on non-production responses;
//   7. (EDGE_DOC_LIMIT=on) per-isolate document limiter on /legends and /openings → rewrite to /too-many-requests, 429;
//   3. api_no_clerk (webhooks, cron, health, /api/openings) → straight through, Clerk never runs;
//   4. cookie-authenticated cross-site API mutation → 403 envelope;
//   5. Clerk: public pages pass; any other page needs a session (→ sign-in); API calls always pass (handlers 401/402);
//   6. (MIDDLEWARE_MEMBER_GATE=on) member pages: claim md.entitled === false → /pricing?reason=required|ended.
import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { MW_START_HEADER, REQUEST_ID_HEADER, requestIdFrom } from "@/lib/api/request-id";
import { classify, type RouteClass } from "@/lib/auth/route-classes";
import {
  CROSS_SITE_MESSAGE,
  PATHNAME_HEADER,
  ROBOTS_HEADER,
  ROBOTS_VALUE,
  clientIpOf,
  createDocLimiter,
  crossSiteBlocked,
  docLimitEnabled,
  hasClerkSessionCookie,
  isDocLimitedPath,
  isDocumentRequest,
  memberGateEnabled,
  memberGateTarget,
  noindexFor,
  returnPathOf,
  tooManyRequestsPath,
} from "@/lib/auth/route-classes/rules";

type Prepared = { cls: RouteClass; requestId: string; forward: Headers };

/** What the outer function computed, handed to the Clerk handler (Clerk passes the same request object through). */
const prepared = new WeakMap<Request, Prepared>();

const docLimiter = createDocLimiter();

function prepare(req: NextRequest): Prepared {
  const cls = classify(req.nextUrl.pathname);
  const requestId = requestIdFrom(req.headers);
  const forward = new Headers(req.headers);
  forward.set(REQUEST_ID_HEADER, requestId);
  forward.set(MW_START_HEADER, String(Date.now()));
  if (cls !== "api" && cls !== "api_no_clerk") {
    forward.set(PATHNAME_HEADER, returnPathOf(req.nextUrl.pathname, req.nextUrl.search));
  }
  return { cls, requestId, forward };
}

const pass = (p: Prepared) => NextResponse.next({ request: { headers: p.forward } });

const withClerk = clerkMiddleware(async (auth, req) => {
  const p = prepared.get(req) ?? prepare(req);
  // API routes: middleware never redirects; handlers answer 401/402/403.
  if (p.cls === "api" || p.cls === "public") return pass(p);

  const { userId, sessionClaims, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn({ returnBackUrl: req.url });

  if (p.cls === "member" && memberGateEnabled(process.env)) {
    const target = memberGateTarget(sessionClaims?.md, `${req.nextUrl.pathname}${req.nextUrl.search}`);
    if (target) return NextResponse.redirect(new URL(target, req.url), 302);
  }
  return pass(p);
});

/** Response headers every non-scanner response carries. */
function finish(res: Response, p: Prepared): Response {
  // API handlers set x-request-id themselves (the same id, forwarded above); only pages get it from here.
  if (p.cls !== "api" && p.cls !== "api_no_clerk" && !res.headers.has(REQUEST_ID_HEADER)) {
    res.headers.set(REQUEST_ID_HEADER, p.requestId);
  }
  if (noindexFor(process.env)) res.headers.set(ROBOTS_HEADER, ROBOTS_VALUE);
  return res;
}

export default async function middleware(req: NextRequest, ev: NextFetchEvent): Promise<Response> {
  const p = prepare(req);

  // Step 1: probes never reach Clerk or a function. Non-production still says noindex (P1-17).
  if (p.cls === "scanner") {
    return new NextResponse(null, {
      status: 404,
      headers: noindexFor(process.env) ? { [ROBOTS_HEADER]: ROBOTS_VALUE } : undefined,
    });
  }

  // Step 7: optional best-effort document limiter on the public catalogue.
  if (
    docLimitEnabled(process.env) &&
    p.cls === "public" &&
    isDocLimitedPath(req.nextUrl.pathname) &&
    isDocumentRequest(req.method, req.headers)
  ) {
    const r = docLimiter.hit(clientIpOf(req.headers), Date.now());
    if (r.limited) {
      const target = tooManyRequestsPath(r.retryAfterSec, `${req.nextUrl.pathname}${req.nextUrl.search}`);
      return finish(
        NextResponse.rewrite(new URL(target, req.url), {
          status: 429,
          headers: { "Retry-After": String(r.retryAfterSec), "Cache-Control": "private, no-store" },
        }),
        p,
      );
    }
  }

  // Step 3: self-verifying and public CDN-cached APIs skip Clerk entirely.
  if (p.cls === "api_no_clerk") return finish(pass(p), p);

  // Step 4: a cookie-authenticated mutation must come from this site.
  if (
    p.cls === "api" &&
    crossSiteBlocked({
      method: req.method,
      hasSessionCookie: hasClerkSessionCookie(req.cookies.getAll().map((c) => c.name)),
      secFetchSite: req.headers.get("sec-fetch-site"),
      origin: req.headers.get("origin"),
      requestOrigin: req.nextUrl.origin,
      siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    })
  ) {
    const body = { error: { code: "forbidden", message: CROSS_SITE_MESSAGE, requestId: p.requestId } };
    return finish(
      NextResponse.json(body, {
        status: 403,
        headers: { [REQUEST_ID_HEADER]: p.requestId, "Cache-Control": "private, no-store" },
      }),
      p,
    );
  }

  // Steps 5 and 6.
  prepared.set(req, p);
  const res = (await withClerk(req, ev)) ?? pass(p);
  return finish(res, p);
}

export const config = {
  matcher: [
    // Pages: skip Next internals, the Sentry tunnel (/monitoring), the PostHog proxy (/ingest), OG images, workers,
    // PWA service-worker files and static files. Scanner paths (.php, .env, …) stay inside so step 1 answers them.
    '/((?!_next|ingest|monitoring|og(?:/|$)|workers|sw\\.js|workbox-|api/health|api/webhook|api/cron|api/openings$|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // API routes always run (static-looking API paths too), except the self-verifying / CDN-cached ones above.
    '/(api(?!/health|/webhook|/cron|/openings$)|trpc)(.*)',
  ],
}
