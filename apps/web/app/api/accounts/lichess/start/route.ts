// OAU-1 `GET /api/accounts/lichess/start?returnTo=/onboarding/link|/settings/connected` (phase-04 plan §7.3.4, §8.14;
// D4-20, D4-29). A full-page navigation: every outcome is a 302. Signed out → the sign-in page (back to `returnTo`);
// the `link` limit (5 / 60 s per user) → `returnTo?lichess=error&reason=rate_limited` rather than a JSON 429 the browser
// would show raw, so the wrapper's limiter is off (`rateLimitWhen`) and the handler applies the registry's spec itself
// (exempt from GET purity like the wrapper's own limiter). Otherwise PKCE S256 + state in the signed
// `rc_lichess_pkce` cookie and a 302 to Lichess's consent page (no scopes). `import-v3` off → 404.
import { rateLimitsOf } from "@repo/contracts/http/endpoint";
import { accountsEndpoints } from "@repo/contracts/http/registry";
import { getRouteDeps } from "@/lib/api/context";
import { route } from "@/lib/api/route";
import { exemptWrites } from "@/lib/api/timing";
import { requireImportFlag } from "@/lib/accounts/flag";
import { startLichessLink } from "@/lib/accounts/lichess-oauth";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const GET = route({ ...accountsEndpoints.lichessStart, rateLimitWhen: () => false }, async (ctx) => {
  const deps = getRouteDeps();
  const origin = new URL(ctx.req.url).origin;
  let rateLimited = false;
  if (ctx.viewer) {
    await requireImportFlag(ctx.viewer);
    const decision = await exemptWrites(() =>
      deps.checkRateLimit(rateLimitsOf(accountsEndpoints.lichessStart), { clerkUserId: ctx.clerkUserId, ip: deps.clientIp(ctx.req.headers) }),
    );
    rateLimited = !decision.allowed;
  }
  const redirect = await startLichessLink({
    origin,
    returnTo: ctx.query.returnTo,
    clerkUserId: ctx.viewer ? ctx.clerkUserId : null,
    rateLimited,
    now: ctx.now,
    env: deps.env,
  });
  const headers = new Headers({ Location: redirect.location });
  for (const cookie of redirect.cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
});
