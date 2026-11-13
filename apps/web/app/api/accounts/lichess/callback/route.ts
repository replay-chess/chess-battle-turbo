// OAU-2 `GET /api/accounts/lichess/callback` (phase-04 plan §7.3.5, §8.14, §8.15; D4-21). Lichess redirects here after
// the consent page; every outcome is a 302 back to the `returnTo` the signed cookie carries, and the cookie is cleared
// on every path. The code exchange, the ownership proof (`GET /api/account`) and the link transaction run with the
// access token in this function's memory only; `DELETE /api/token` runs in a `finally` before the redirect goes out,
// on every path that obtained a token. Nothing about the token is logged or stored (lib/accounts/lichess-oauth.ts).
//
// GET purity: the link transaction is this GET's purpose (a provider redirect cannot POST); the registry declares it
// (`sideEffects: ["oauth_link"]`), so route() allows the write.
import { accountsEndpoints } from "@repo/contracts/http/registry";
import { getRouteDeps } from "@/lib/api/context";
import { route } from "@/lib/api/route";
import { runLinkEffects } from "@/lib/accounts/effects";
import { importEnabledFor } from "@/lib/accounts/flag";
import { clearedPkceCookie, finishLichessLink } from "@/lib/accounts/lichess-oauth";
import { errorResponse } from "@/lib/api/respond";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export const GET = route(accountsEndpoints.lichessCallback, async (ctx) => {
  const deps = getRouteDeps();
  const viewer = ctx.viewer;
  // import-v3 off for the viewer: the same 404 as every OAU/ACC route, but the PKCE cookie is cleared here too (plan
  // §7.3.5 "cleared on every path"; FIX-2, the class of FIX-1 #27).
  if (viewer && !(await importEnabledFor(viewer))) {
    return errorResponse(
      { code: "not_found", requestId: ctx.requestId },
      { headers: { "Set-Cookie": clearedPkceCookie(new URL(ctx.req.url).origin) } },
    );
  }
  const outcome = await finishLichessLink({
    origin: new URL(ctx.req.url).origin,
    cookieHeader: ctx.req.headers.get("cookie"),
    query: ctx.query,
    viewer,
    clerkUserId: ctx.clerkUserId,
    now: ctx.now,
    env: deps.env,
    onError: (err) => deps.telemetry.captureException(err, { tags: { route: accountsEndpoints.lichessCallback.id } }),
  });
  deps.telemetry.setTag("lichess_result", outcome.result);
  if (viewer && outcome.effects.length) {
    ctx.after(() => runLinkEffects(outcome.effects, { viewer, requestId: ctx.requestId, now: ctx.now }));
  }
  const headers = new Headers({ Location: outcome.location });
  for (const cookie of outcome.cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
});
