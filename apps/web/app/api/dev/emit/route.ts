// /api/dev/emit (phase-06 plan §7.10, §12.4; testing X12): pushes ONE registered user-room event to the CALLER's own
// `user:` room, so an e2e spec can drive a screen's realtime states (the Weakness Profile's progress milestones)
// deterministically. A test hook: it exists only when `testHooksEnabled()` (NEXT_PUBLIC_APP_ENV dev/test AND
// ALLOW_TEST_HOOKS=1) and the request carries `x-e2e-token` = E2E_TEST_TOKEN; everyone else, and every production
// build, gets 404 (lib/test-hooks/registry.ts entry `dev-emit`; prod-guard.spec.ts).
//
//   POST {v:1, event, data}   → 202 {data: {event, delivered}}   (signed in; the room is the session's own user)
//
// Only the user-room events of the socket registry (CT socket/user.ts USER_EVENTS) are accepted, each validated with
// its own schema and size budget; `entitlement:changed` is refused (it must only ever come from billing). The target
// is never taken from the body: it is the signed-in viewer's ref. The emit is the web's own signed `/internal/emit`
// (lib/internal/fetch.ts, kid `web`), the same hop production code uses.
//
// Not a route() handler, on purpose (as /api/dev/import-fault, FIX-1): route() validates the body, rate-limits and
// authenticates before its handler runs, so a production build would answer a malformed body 400 instead of the 404
// every test hook owes every request. The authz walker covers it through its legacy rows (test/authz/legacy-routes.ts).
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { USER_EVENTS, USER_EVENT_BUDGETS, type UserEventName } from "@repo/contracts/socket/user";
import { errorResponse } from "@/lib/auth/error-response";
import { tokenMatchesSecret } from "@/lib/auth/secrets";
import { testHooksEnabled } from "@/lib/env-server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/** The body: `{v:1, event, data}` with the largest event budget (640 B) and room for the envelope. */
const DEV_EMIT_BODY_MAX_BYTES = 1_024;
/** Events a spec may push; `entitlement:changed` only ever comes from billing. */
const DEV_EMIT_EVENTS: readonly UserEventName[] = (Object.keys(USER_EVENTS) as UserEventName[]).filter((e) => e !== "entitlement:changed");

const notFound = () => errorResponse("not_found", "Not found.");

/** No GET: 404 like every other request the hook does not serve (prod-guard.spec.ts probes every hook path with GET). */
export async function GET(): Promise<NextResponse> {
  return notFound();
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!testHooksEnabled() || !tokenMatchesSecret(req.headers.get("x-e2e-token"), process.env.E2E_TEST_TOKEN)) return notFound();
  const { getViewer } = await import("@/lib/auth/viewer");
  const viewer = await getViewer();
  if (!viewer) return errorResponse("unauthorized", "Sign in first.");
  const text = await req.text();
  if (Buffer.byteLength(text) > DEV_EMIT_BODY_MAX_BYTES) return errorResponse("validation_failed", "The body is too large.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return errorResponse("invalid_json", "The body is not JSON.");
  }
  const body = json as { v?: unknown; event?: unknown; data?: unknown } | null;
  const event = typeof body?.event === "string" ? (body.event as UserEventName) : null;
  if (body?.v !== 1 || !event || !DEV_EMIT_EVENTS.includes(event)) {
    return errorResponse("validation_failed", `Expected {v:1, event, data} with event one of ${DEV_EMIT_EVENTS.join(", ")}.`);
  }
  const data = USER_EVENTS[event].safeParse(body.data);
  if (!data.success) return errorResponse("validation_failed", `The data is not a valid ${event} payload.`);
  if (Buffer.byteLength(JSON.stringify(data.data)) > USER_EVENT_BUDGETS[event]) {
    return errorResponse("validation_failed", `The data is over the ${event} budget (${USER_EVENT_BUDGETS[event]} B).`);
  }
  const { internalFetch } = await import("@/lib/internal/fetch");
  let res: Response;
  try {
    res = await internalFetch("/internal/emit", {
      body: { v: 1, targets: [{ userRef: viewer.ref }], event, data: data.data, dedupeKey: `dev-emit:${event}:${randomUUID()}` },
    });
  } catch {
    return NextResponse.json({ error: { code: "upstream_unavailable", message: "The socket server did not answer." } }, { status: 502 });
  }
  if (!res.ok) {
    return NextResponse.json({ error: { code: "upstream_unavailable", message: `The socket server refused the emit (${res.status}).` } }, { status: 502 });
  }
  const out = (await res.json().catch(() => null)) as { delivered?: number } | null;
  return NextResponse.json({ data: { event, delivered: typeof out?.delivered === "number" ? out.delivered : null } }, { status: 202, headers: { "cache-control": "private, no-store" } });
}
