// /api/dev/import-fault (phase-04 plan §7.7.4, §11.1 last rows; testing X12): the web side of `/dev/import`. A test
// hook: it exists only when `testHooksEnabled()` (NEXT_PUBLIC_APP_ENV dev/test AND ALLOW_TEST_HOOKS=1), and then
// only for an admin session or a request carrying `x-e2e-token` = E2E_TEST_TOKEN (the e2e specs). Everyone else,
// and every production build, gets 404 (lib/test-hooks/registry.ts entry `dev-import-fault`; prod-guard.spec.ts).
//
//   GET                                          → the worker's fault table          200 {data: DevFaultData}
//   POST {v:1, provider, mode, ttlSec ≤ 600}     → sets / clears one provider's fault 200 {data: DevFaultData}
//
// The worker call is signed like every web → worker hop (kid `webwk`, lib/services/analysis/kick.ts
// `workerSignature`), to `/internal/dev/fault`, which the worker serves only with IMPORT_FAULTS_ALLOWED=1 (never in
// production) and Caddy proxies only on the dev box. A worker that is not configured or does not answer is a 502.
//
// Not a route() handler, on purpose (the one exception in the §7.0 catalogue, FIX-1): route() validates the body,
// rate-limits and authenticates before its handler runs, so a production build would answer a malformed body 400
// instead of the 404 every test hook owes every request (prod-guard.spec.ts, lib/test-hooks/registry.ts). The authz
// walker covers it through its legacy rows (test/authz/legacy-routes.ts).
import { NextResponse, type NextRequest } from "next/server";
import { DevFaultBody, DevFaultData, PROVIDER_BODY_MAX_BYTES, WORKER_DEV_FAULT_PATH } from "@repo/contracts/internal/provider";
import { errorResponse } from "@/lib/auth/error-response";
import { tokenMatchesSecret } from "@/lib/auth/secrets";
import { testHooksEnabled } from "@/lib/env-server";
import { InternalFetchConfigError } from "@/lib/internal/fetch";
import { workerOrigin, workerSignature } from "@/lib/services/analysis/kick";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/** The worker answers from memory; anything slower is a broken hop. */
const WORKER_TIMEOUT_MS = 5_000;

const notFound = () => errorResponse("not_found", "Not found.");

/** The hook is on and the caller is an admin or the e2e runner. Never reveals which check failed. */
async function allowed(req: NextRequest): Promise<boolean> {
  if (!testHooksEnabled()) return false;
  if (tokenMatchesSecret(req.headers.get("x-e2e-token"), process.env.E2E_TEST_TOKEN)) return true;
  // Loaded only when needed: the e2e path never touches Clerk or the database.
  const { requireAdmin } = await import("@/lib/auth/require-admin");
  const admin = await requireAdmin();
  return admin.error === null;
}

async function callWorker(method: "GET" | "POST", body: string): Promise<NextResponse> {
  const env = process.env;
  const origin = workerOrigin(env);
  if (!origin) return errorResponse("internal", "The analysis worker is not configured (ANALYSIS_WORKER_URL).");
  let headers: Record<string, string>;
  try {
    // The wall clock on purpose: the worker checks the signature's timestamp against its own clock.
    headers = { ...workerSignature(env, method, WORKER_DEV_FAULT_PATH, body, Date.now()), "content-type": "application/json" };
  } catch (error) {
    if (error instanceof InternalFetchConfigError) return errorResponse("internal", "INTERNAL_API_SECRET has no webwk key.");
    throw error;
  }
  let res: Response;
  try {
    res = await fetch(`${origin}${WORKER_DEV_FAULT_PATH}`, {
      method,
      headers,
      body: method === "POST" ? body : undefined,
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: { code: "upstream_unavailable", message: "The worker did not answer." } }, { status: 502 });
  }
  const json: unknown = await res.json().catch(() => null);
  const data = DevFaultData.safeParse(json);
  if (!res.ok || !data.success) {
    // 404 here: the worker runs without IMPORT_FAULTS_ALLOWED (or Caddy does not route /internal/dev/* to it).
    return NextResponse.json(
      { error: { code: "upstream_unavailable", message: `The worker refused the fault table (${res.status}).` } },
      { status: 502 },
    );
  }
  return NextResponse.json({ data: data.data }, { headers: { "cache-control": "private, no-store" } });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await allowed(req))) return notFound();
  return callWorker("GET", "");
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!(await allowed(req))) return notFound();
  const text = await req.text();
  if (Buffer.byteLength(text) > PROVIDER_BODY_MAX_BYTES) return errorResponse("validation_failed", "The body is too large.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return errorResponse("invalid_json", "The body is not JSON.");
  }
  const parsed = DevFaultBody.safeParse(json);
  if (!parsed.success) return errorResponse("validation_failed", "Expected {v:1, provider, mode, ttlSec ≤ 600}.");
  return callWorker("POST", JSON.stringify(parsed.data));
}
