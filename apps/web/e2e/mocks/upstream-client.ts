// The specs' handle on the upstream mock (./upstream-server.ts; phase-04 plan §12.4). The mock runs on 4010
// (+ E2E_PORT_OFFSET); playwright.config.ts starts it and points the web (`/chesscom`, `/lichess`, `/dodo`) and the
// worker (`/chesscom-worker`, `/lichess-worker`) at it. Controls that would leak between parallel specs are keyed:
// faults by a path regex (a spec's own handle), Dodo by the customer's email, Lichess by the username typed on the
// consent page.
export const UPSTREAM_PORT = 4010 + (Number(process.env.E2E_PORT_OFFSET ?? 0) || 0);
export const UPSTREAM_URL = `http://127.0.0.1:${UPSTREAM_PORT}`;

/** The env the web, socket and worker servers get (playwright.config.ts). */
export function upstreamEnv(target: "web" | "worker"): Record<string, string> {
  const suffix = target === "worker" ? "-worker" : "";
  return {
    CHESSCOM_API_BASE: `${UPSTREAM_URL}/chesscom${suffix}`,
    // The web's Lichess base is also where the browser goes for the consent page: `localhost` keeps that redirect chain
    // same-site with the app (http://localhost:<web>), as the real https deployment is for Clerk's cookies; the mock
    // listens on 127.0.0.1 and ::1, so the server-side calls resolve either way.
    LICHESS_BASE_URL: target === "worker" ? `${UPSTREAM_URL}/lichess-worker` : `http://localhost:${UPSTREAM_PORT}/lichess`,
    ...(target === "web" ? { DODO_API_BASE_URL: `${UPSTREAM_URL}/dodo` } : {}),
  };
}

export type UpstreamRequest = { provider: "chesscom" | "lichess" | "dodo"; caller: "web" | "worker"; method: string; path: string; at: number };

export type UpstreamState = {
  requests: UpstreamRequest[];
  revoked: string[];
  revokedUsers: string[];
  maxConcurrency: Record<string, number>;
  authOnExport: number;
  sessions: { id: string; customerId: string; productId: string; trialDays: number; paid: boolean; subscriptionId: string | null }[];
  subscriptions: { id: string; status: string }[];
  webhooks: { type: string; subscriptionId: string; status: number | null; at: number }[];
};

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${UPSTREAM_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`upstream mock ${path} answered ${res.status}`);
  return (await res.json()) as T;
}

export const upstream = {
  state: () => call<UpstreamState>("/__mock/state"),
  /** `status` for the next `times` requests to `provider` whose path matches `match` (a regex source). */
  fault: (provider: "chesscom" | "lichess" | "dodo", status: number, opts: { times?: number; match?: string } = {}) =>
    call("/__mock/fault", { provider, status, ...opts }),
  /** Requests to `provider` whose path matches `match` wait `ms` (≤ 30 s) before the mock answers. */
  delay: (provider: "chesscom" | "lichess" | "dodo", ms: number, match: string) => call("/__mock/delay", { provider, ms, match }),
  /** Removes the delays of `provider` (only the one registered with `match`, when given: parallel specs keep theirs). */
  clearDelays: (provider: "chesscom" | "lichess" | "dodo", match?: string) => call("/__mock/delay", { provider, clear: true, ...(match ? { match } : {}) }),
  clearFaults: (provider: "chesscom" | "lichess" | "dodo") => call("/__mock/fault", { provider, clear: true }),
  /** Dodo behaviour for one customer (the checkout's email): webhook delay, no webhook, a declined payment. */
  dodoFor: (email: string, control: { webhookDelayMs?: number; webhook?: boolean; decline?: boolean; pendingUntilWebhook?: boolean; clear?: boolean }) =>
    call("/__mock/dodo", { email, ...control }),
  subscription: (id: string) => call<Record<string, unknown> & { subscription_id: string; customer: { customer_id: string; email: string } }>(`/dodo/subscriptions/${encodeURIComponent(id)}`),
  /** Requests to `provider` whose path contains `fragment` (e.g. a spec's own handle). */
  async requestsFor(provider: UpstreamRequest["provider"], fragment: string, caller?: UpstreamRequest["caller"]): Promise<UpstreamRequest[]> {
    const s = await call<UpstreamState>("/__mock/state");
    return s.requests.filter((r) => r.provider === provider && r.path.toLowerCase().includes(fragment.toLowerCase()) && (!caller || r.caller === caller));
  },
  /** How many times the token of Lichess user `username` was revoked. */
  async revokesFor(username: string): Promise<number> {
    const s = await call<UpstreamState>("/__mock/state");
    return s.revokedUsers.filter((u) => u === username.toLowerCase()).length;
  },
  async healthy(): Promise<boolean> {
    try {
      return (await fetch(`${UPSTREAM_URL}/__health`, { signal: AbortSignal.timeout(2_000) })).ok;
    } catch {
      return false;
    }
  },
};
