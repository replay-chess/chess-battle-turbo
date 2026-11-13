// Upstream mock (phase-04 plan §12.4): Chess.com's published-data API, Lichess (OAuth with PKCE, the account read, the
// token revoke and the game export) and Dodo's REST API (checkout sessions, subscriptions) behind one HTTP server, so
// the local stack and CI e2e never call a real provider or payment processor. Answers are built from
// @repo/chess-fixtures/import; every handle gets its own copy of the fixture games (ids tagged per handle), so many
// test users can import "their" account into one database without sharing a game.
//
//   Chess.com  GET /chesscom/pub/player/{u}                     profile   (ETag / If-None-Match → 304 on archives+months)
//              (the worker's base is /chesscom-worker/…: same answers, but `blocked…` handles are found there, so the web's
//              403 → worker fallback path is real; worker requests are counted apart for the concurrency check)
//              GET /chesscom/pub/player/{u}/stats               stats
//              GET /chesscom/pub/player/{u}/games/archives      archive list
//              GET /chesscom/pub/player/{u}/games/{yyyy}/{mm}   one month
//   Lichess    GET /lichess/oauth?…                             the consent page (HTML: a username field, Approve and Deny;
//                                                               `/__mock/lichess {auto: true}` 302s at once instead)
//              GET /lichess/oauth/decide?…&approve=1|0           the page's buttons: 302 back with `code` (or `error`)
//              POST /lichess/api/token                          code + PKCE verifier → access token
//              DELETE /lichess/api/token                        revoke (recorded; asserted by the e2e specs)
//              GET /lichess/api/account                         Bearer → the account the consent chose
//              GET /lichess/api/user/{u}                        public account
//              GET /lichess/api/games/user/{u}?since&until&max&perfType  NDJSON, newest first, paced at 20 games/s (the anonymous
//                                                               rate); an `Authorization` header is refused (400) and
//                                                               counted (`authOnExport`): imports are anonymous (D4-21)
//              (the worker's base is /lichess-worker/…)
//   Dodo       POST /dodo/checkouts, GET /dodo/checkouts/{id}, GET /dodo/subscriptions?customer_id=,
//              GET|PATCH /dodo/subscriptions/{id}
//              GET /dodo/pay/{session}                          the hosted checkout, paid at once: creates the
//                                                               subscription, 302s to `return_url` and delivers the
//                                                               signed `subscription.active` webhook to the web app
//
// Handles drive the Chess.com answers: `notfound…`/`nobody…`/`knightowl88xx…` → 404, `closed…` → a closed (private)
// profile, `quiet…` (`quiet_rook`) → 410 Gone (a closed account), `empty…` → a profile with no games,
// `ratelimited…` → 429 `Retry-After: 30` (web and worker), `blocked…` → 403 for the web (found through the worker
// fallback), `boom…` → 503; anything else → the knightowl_88 fixture renamed to that handle.
//
// Control (tests): POST /__mock/fault {provider, status, times?, match?}, POST /__mock/lichess {username?, deny?, auto?,
// gamesPerSec?}, POST /__mock/dodo {email?, webhookDelayMs?, webhook?, decline?, pendingUntilWebhook?} (with `email`: for
// that customer only, so parallel specs do not share it), GET /__mock/state (requests, revoked tokens, sessions,
// subscriptions, webhooks, max concurrency per provider and caller, `authOnExport`), POST /__mock/delay {provider, ms,
// match} (a slow upstream for the paths matching `match`), POST /__mock/reset, GET /__health.
// `/__control` is the plan's name for the same: GET = the state, POST {fault?, lichess?, dodo?, reset?}.
//
// Run: `npx tsx e2e/mocks/upstream-server.ts [--port 4010] [--web http://localhost:3000]`; the Dodo webhook is signed
// with DODO_PAYMENTS_WEBHOOK_KEY from the environment (source .env.test in a subshell). Never point it at production.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Webhook } from "standardwebhooks";

export const DEFAULT_UPSTREAM_PORT = 4010;

type Json = Record<string, unknown>;
type Provider = "chesscom" | "lichess" | "dodo";
/** Who called: the web app's base (`/chesscom`, `/lichess`) or the worker's (`/chesscom-worker`, `/lichess-worker`). */
export type Caller = "web" | "worker";

const require = createRequire(import.meta.url);
const fixtureText = (rel: string) => readFileSync(require.resolve(`@repo/chess-fixtures/import/${rel}`), "utf8");
const FIXTURE_HANDLE = "knightowl_88";
const LICHESS_FIXTURE_ID = "knightowl88";
const MONTHS = ["2026-08", "2026-09", "2026-10"] as const;

/** A short decimal tag per handle: game ids stay unique across handles (Chess.com ids end in digits). */
export function handleTag(handle: string): string {
  return String(parseInt(createHash("sha256").update(handle.toLowerCase()).digest("hex").slice(0, 8), 16) % 1_000_000).padStart(6, "0");
}

/** An 8-character Lichess game id for game `i` of `handle` (the export schema's shape). */
export function lichessGameId(handle: string, i: number): string {
  const prefix = BigInt(`0x${createHash("sha256").update(handle.toLowerCase()).digest("hex").slice(0, 10)}`).toString(36).slice(-5).padStart(5, "0");
  return `${prefix}${i.toString(36).padStart(3, "0")}`;
}

export type ChessComKind = "found" | "not_found" | "closed" | "gone" | "empty" | "rate_limited" | "blocked" | "boom";

export function chessComKindOf(handle: string): ChessComKind {
  const h = handle.toLowerCase();
  if (h.startsWith("notfound") || h.startsWith("nobody") || h.startsWith("knightowl88xx")) return "not_found";
  if (h.startsWith("closed")) return "closed";
  if (h.startsWith("quiet")) return "gone";
  if (h.startsWith("empty")) return "empty";
  if (h.startsWith("ratelimited")) return "rate_limited";
  if (h.startsWith("blocked")) return "blocked";
  if (h.startsWith("boom")) return "boom";
  return "found";
}

/** The kinds whose profile, stats and archives exist (the worker also finds `blocked…`). */
function hasGames(kind: ChessComKind, caller: Caller): boolean {
  return kind === "found" || (kind === "blocked" && caller === "worker");
}

function renameChessComGame(g: Json, handle: string, tag: string): Json {
  const side = (s: Json) =>
    String(s.username).toLowerCase() === FIXTURE_HANDLE
      ? { ...s, username: handle, "@id": `https://api.chess.com/pub/player/${handle.toLowerCase()}` }
      : s;
  return {
    ...g,
    url: String(g.url).replace(/(\d+)$/, `$1${tag}`),
    uuid: `${String(g.uuid)}-${tag}`,
    pgn: typeof g.pgn === "string" ? g.pgn.replaceAll("KnightOwl_88", handle) : g.pgn,
    white: side(g.white as Json),
    black: side(g.black as Json),
  };
}

/** Month key "YYYY/MM" → games of `handle` (oldest first, as Chess.com serves them). */
export function chessComMonths(handle: string, caller: Caller = "web"): Map<string, Json[]> {
  const kind = chessComKindOf(handle);
  const months = new Map<string, Json[]>();
  if (!hasGames(kind, caller)) return months;
  const tag = handleTag(handle);
  for (const m of MONTHS) {
    const body = JSON.parse(fixtureText(`chesscom/${FIXTURE_HANDLE}/${m}.json`)) as { games: Json[] };
    months.set(m.replace("-", "/"), body.games.map((g) => renameChessComGame(g, handle, tag)));
  }
  return months;
}

function chessComProfile(handle: string): Json {
  const base = JSON.parse(fixtureText(`chesscom/${FIXTURE_HANDLE}/profile.json`)) as Json;
  const lower = handle.toLowerCase();
  return {
    ...base,
    username: lower,
    "@id": `https://api.chess.com/pub/player/${lower}`,
    url: `https://www.chess.com/member/${handle}`,
    player_id: 41_000_000 + Number(handleTag(handle)),
    ...(chessComKindOf(handle) === "closed" ? { status: "closed:fair_play_violations" } : {}),
  };
}

function chessComStats(handle: string): Json {
  if (chessComKindOf(handle) === "empty") return {};
  return JSON.parse(fixtureText(`chesscom/${FIXTURE_HANDLE}/stats.json`)) as Json;
}

/** Export lines of `lichessId`, newest first (malformed fixture lines dropped). */
export function lichessLines(lichessId: string): Json[] {
  const id = lichessId.toLowerCase();
  const out: Json[] = [];
  const raw = fixtureText(`lichess/${LICHESS_FIXTURE_ID}/games.ndjson`).split("\n").filter((l) => l.trim() !== "");
  raw.forEach((line, i) => {
    let g: Json;
    try {
      g = JSON.parse(line) as Json;
    } catch {
      return;
    }
    const players = g.players as Record<"white" | "black", Json>;
    const rename = (p: Json): Json => {
      const user = p.user as Json | undefined;
      return user && String(user.id) === LICHESS_FIXTURE_ID ? { ...p, user: { ...user, id, name: lichessId } } : p;
    };
    out.push({ ...g, id: lichessGameId(id, i), players: { white: rename(players.white), black: rename(players.black) } });
  });
  return out.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
}

function lichessAccount(username: string): Json {
  const base = JSON.parse(fixtureText(`lichess/${LICHESS_FIXTURE_ID}/account.json`)) as Json;
  return { ...base, id: username.toLowerCase(), username, url: `https://lichess.org/@/${username}` };
}

// ── state ─────────────────────────────────────────────────────────────────────────────────────────────────────────
type Fault = { provider: Provider; status: number; times: number; match: RegExp | null };
/** A slow upstream: requests to `provider` whose path matches wait `ms` before the answer (an import in progress). */
type Delay = { provider: Provider; ms: number; match: RegExp };
/**
 * `pendingUntilWebhook`: the subscription reads `pending` from the REST API until its webhook is delivered, so the
 * app's Dodo self-heal (activation after 6 s) cannot finish the activation early (the stalled / poll specs).
 */
type DodoControl = { webhookDelayMs: number; webhook: boolean; decline: boolean; pendingUntilWebhook: boolean };
type Session = {
  id: string;
  customerId: string;
  email: string;
  name: string | null;
  productId: string;
  trialDays: number;
  metadata: Record<string, string>;
  returnUrl: string;
  paid: boolean;
  subscriptionId: string | null;
};
type Subscription = Json & { subscription_id: string; customer: { customer_id: string; email: string; name?: string } };

export class UpstreamState {
  requests: { provider: Provider; caller: Caller; method: string; path: string; at: number; userAgent: string | null }[] = [];
  faults: Fault[] = [];
  delays: Delay[] = [];
  lichess = { username: "KnightOwl88", deny: false, auto: false, gamesPerSec: 20 };
  codes = new Map<string, { challenge: string; redirectUri: string; username: string }>();
  tokens = new Map<string, string>();
  revoked: string[] = [];
  /** The Lichess usernames (lower case) whose token was revoked, one entry per revoke (D4-21: exactly one per link). */
  revokedUsers: string[] = [];
  dodo: DodoControl = { webhookDelayMs: 1_500, webhook: true, decline: false, pendingUntilWebhook: false };
  /** Per-customer overrides of `dodo` (key: the lower-cased checkout email). */
  dodoFor = new Map<string, Partial<DodoControl>>();
  /** In-flight and peak concurrent requests per `provider:caller` (the worker's gate allows one at a time). */
  inflight = new Map<string, number>();
  maxConcurrency: Record<string, number> = {};
  /** Lichess game-export requests that carried an Authorization header (must stay 0: imports are anonymous). */
  authOnExport = 0;
  customers = new Map<string, string>();
  sessions = new Map<string, Session>();
  subscriptions = new Map<string, Subscription>();
  webhooks: { type: string; subscriptionId: string; status: number | null; at: number }[] = [];

  reset(): void {
    Object.assign(this, new UpstreamState());
  }

  dodoControlFor(email: string): DodoControl {
    return { ...this.dodo, ...(this.dodoFor.get(email.toLowerCase()) ?? {}) };
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function etagOf(body: unknown): string {
  return `"${createHash("sha1").update(JSON.stringify(body)).digest("hex").slice(0, 20)}"`;
}

/** 200 with an ETag, or 304 when the request's If-None-Match matches. */
function cacheable(req: IncomingMessage, res: ServerResponse, body: unknown): void {
  const tag = etagOf(body);
  if (req.headers["if-none-match"] === tag) {
    res.writeHead(304, { etag: tag });
    res.end();
    return;
  }
  json(res, 200, body, { etag: tag, "last-modified": "Wed, 11 Nov 2026 00:00:00 GMT" });
}

function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function bearerOf(req: IncomingMessage): string | null {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
  return m ? m[1]! : null;
}

/** Lichess's consent screen, reduced to what the e2e specs click: a username, Approve and Deny. */
function consentPage(res: ServerResponse, url: URL, username: string): void {
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const hidden = [...url.searchParams.entries()]
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Lichess (mock): authorize</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<main><h1>Authorize Replay Chess</h1><p>Read-only access to your public games (mock).</p>
<form method="get" action="/lichess/oauth/decide">${hidden}
<label>Lichess username <input name="username" value="${esc(username)}" data-testid="mock-lichess-username"></label>
<button type="submit" name="approve" value="1" data-testid="mock-lichess-approve">Approve</button>
<button type="submit" name="approve" value="0" data-testid="mock-lichess-deny">Deny</button>
</form></main></body></html>`;
  // No Referer back to the app: Clerk's middleware answers a document navigation with a cross-origin Referer by a
  // handshake through the Clerk frontend API (PrimaryDomainCrossOriginSync). Over plain-http localhost that round trip
  // drops the session in WebKit, so the callback ran signed out (`?lichess=error&reason=state`) on webkit-iphone. The
  // callback's own logic is what the specs test; the handshake belongs to Clerk (regression: p04-webkit-oauth-cookie).
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "referrer-policy": "no-referrer" });
  res.end(body);
}

/** NDJSON lines at `perSec` lines per second (0 = all at once); stops when the client goes away. */
async function streamLines(res: ServerResponse, lines: Json[], perSec: number): Promise<void> {
  if (perSec <= 0 || lines.length === 0) {
    res.end(lines.map((g) => JSON.stringify(g)).join("\n") + (lines.length ? "\n" : ""));
    return;
  }
  let closed = false;
  res.on("close", () => {
    closed = true;
  });
  for (const g of lines) {
    if (closed) return;
    res.write(`${JSON.stringify(g)}\n`);
    await new Promise((r) => setTimeout(r, 1000 / perSec));
  }
  res.end();
}

// ── providers ─────────────────────────────────────────────────────────────────────────────────────────────────────
function chessCom(req: IncomingMessage, res: ServerResponse, p: string, caller: Caller): void {
  const m = /^\/pub\/player\/([^/]+)(\/stats|\/games\/archives|\/games\/(\d{4})\/(\d{2}))?$/.exec(p);
  if (!m || req.method !== "GET") return json(res, 404, { code: 0, message: "not found" });
  const handle = decodeURIComponent(m[1]!);
  const kind = chessComKindOf(handle);
  if (kind === "not_found") return json(res, 404, { code: 0, message: `User "${handle}" not found.` });
  if (kind === "gone") return json(res, 410, { code: 0, message: `User "${handle}" is closed.` });
  if (kind === "rate_limited") return json(res, 429, { code: 0, message: "Too many requests" }, { "retry-after": "30" });
  if (kind === "boom") return json(res, 503, { code: 0, message: "Service unavailable" });
  if (kind === "blocked" && caller === "web") return json(res, 403, { code: 0, message: "Forbidden" });
  if (!m[2]) return json(res, 200, chessComProfile(handle));
  if (m[2] === "/stats") return json(res, 200, chessComStats(handle));
  const months = chessComMonths(handle, caller);
  if (m[2] === "/games/archives") {
    const archives = [...months.keys()].map((k) => `https://api.chess.com/pub/player/${handle.toLowerCase()}/games/${k}`);
    return cacheable(req, res, { archives });
  }
  const games = months.get(`${m[3]}/${m[4]}`) ?? [];
  return cacheable(req, res, { games });
}

async function lichess(req: IncomingMessage, res: ServerResponse, p: string, url: URL, state: UpstreamState): Promise<void> {
  if ((p === "/oauth" || p === "/oauth/decide") && req.method === "GET") {
    const redirect = url.searchParams.get("redirect_uri");
    const st = url.searchParams.get("state") ?? "";
    const challenge = url.searchParams.get("code_challenge");
    if (!redirect || !challenge || url.searchParams.get("code_challenge_method") !== "S256") {
      return json(res, 400, { error: "invalid_request" });
    }
    if (p === "/oauth" && !state.lichess.auto) return consentPage(res, url, state.lichess.username);
    const decided = p === "/oauth/decide";
    const deny = decided ? url.searchParams.get("approve") !== "1" : state.lichess.deny;
    const username = (decided ? url.searchParams.get("username")?.trim() : "") || state.lichess.username;
    const back = new URL(redirect);
    if (deny) {
      back.searchParams.set("error", "access_denied");
      back.searchParams.set("error_description", "user cancelled authorization");
    } else {
      const code = randomBytes(12).toString("hex");
      state.codes.set(code, { challenge, redirectUri: redirect, username });
      back.searchParams.set("code", code);
    }
    back.searchParams.set("state", st);
    res.writeHead(302, { location: back.toString(), "referrer-policy": "no-referrer" });
    res.end();
    return;
  }
  if (p === "/api/token" && req.method === "POST") {
    const form = new URLSearchParams(await readBody(req));
    const entry = state.codes.get(form.get("code") ?? "");
    if (!entry || form.get("grant_type") !== "authorization_code") return json(res, 400, { error: "invalid_grant" });
    if (s256(form.get("code_verifier") ?? "") !== entry.challenge || form.get("redirect_uri") !== entry.redirectUri) {
      return json(res, 400, { error: "invalid_grant", error_description: "PKCE or redirect mismatch" });
    }
    state.codes.delete(form.get("code")!);
    const token = `lio_${randomBytes(16).toString("hex")}`;
    state.tokens.set(token, entry.username);
    return json(res, 200, { token_type: "Bearer", access_token: token, expires_in: 31_536_000 });
  }
  if (p === "/api/token" && req.method === "DELETE") {
    const token = bearerOf(req);
    if (token && state.tokens.has(token)) {
      state.revokedUsers.push(state.tokens.get(token)!.toLowerCase());
      state.tokens.delete(token);
      state.revoked.push(token.slice(0, 8));
    }
    res.writeHead(204);
    res.end();
    return;
  }
  if (p === "/api/account" && req.method === "GET") {
    const token = bearerOf(req);
    const username = token ? state.tokens.get(token) : undefined;
    if (!username) return json(res, 401, { error: "No such token" });
    return json(res, 200, lichessAccount(username));
  }
  const user = /^\/api\/user\/([^/]+)$/.exec(p);
  if (user && req.method === "GET") return json(res, 200, lichessAccount(decodeURIComponent(user[1]!)));
  const games = /^\/api\/games\/user\/([^/]+)$/.exec(p);
  if (games && req.method === "GET") {
    if (req.headers.authorization) {
      state.authOnExport++;
      return json(res, 400, { error: "the mock refuses an Authorization header on the export: imports are anonymous" });
    }
    const since = Number(url.searchParams.get("since") ?? 0);
    const until = Number(url.searchParams.get("until") ?? Number.MAX_SAFE_INTEGER);
    const max = Number(url.searchParams.get("max") ?? 10_000);
    const rated = url.searchParams.get("rated");
    let lines = lichessLines(decodeURIComponent(games[1]!)).filter((g) => Number(g.createdAt) >= since && Number(g.createdAt) <= until);
    if (rated === "true") lines = lines.filter((g) => g.rated === true);
    // `perfType` as Lichess applies it (the worker's correspondence look-back sends perfType=correspondence).
    const perfType = url.searchParams.get("perfType");
    if (perfType) {
      const speeds = new Set(perfType.split(","));
      lines = lines.filter((g) => speeds.has(String(g.speed ?? g.perf ?? "")));
    }
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    await streamLines(res, lines.slice(0, max), state.lichess.gamesPerSec);
    return;
  }
  json(res, 404, { error: "Not found" });
}

// ── Dodo ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function intervalOf(productId: string): "Month" | "Year" {
  return productId === process.env.DODO_PRODUCT_ID_YEARLY ? "Year" : "Month";
}

function newSubscription(s: Session): Subscription {
  const now = Date.now();
  const periodDays = s.trialDays > 0 ? s.trialDays : intervalOf(s.productId) === "Year" ? 365 : 30;
  return {
    subscription_id: `sub_mock_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    product_id: s.productId,
    status: "active",
    next_billing_date: new Date(now + periodDays * 86_400_000).toISOString(),
    previous_billing_date: new Date(now).toISOString(),
    cancel_at_next_billing_date: false,
    created_at: new Date(now).toISOString(),
    payment_frequency_interval: intervalOf(s.productId),
    trial_period_days: s.trialDays,
    recurring_pre_tax_amount: intervalOf(s.productId) === "Year" ? 5000 : 499,
    currency: "USD",
    customer: { customer_id: s.customerId, email: s.email, ...(s.name ? { name: s.name } : {}) },
    metadata: s.metadata,
  };
}

async function deliverWebhook(web: string, type: string, sub: Subscription, state: UpstreamState): Promise<void> {
  const key = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
  const entry = { type, subscriptionId: sub.subscription_id, status: null as number | null, at: Date.now() };
  state.webhooks.push(entry);
  if (!key) return;
  const id = `msg_mock_${randomUUID()}`;
  const signedAt = new Date();
  if (sub.status === "pending") sub.status = "active";
  const body = JSON.stringify({ business_id: "bus_mock", type, timestamp: new Date().toISOString(), data: sub });
  const signature = new Webhook(key).sign(id, signedAt, body);
  try {
    const r = await fetch(`${web}/api/webhook/dodo-payments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": id,
        "webhook-timestamp": String(Math.floor(signedAt.getTime() / 1000)),
        "webhook-signature": signature,
      },
      body,
    });
    entry.status = r.status;
  } catch {
    entry.status = 0;
  }
}

async function dodo(req: IncomingMessage, res: ServerResponse, p: string, url: URL, state: UpstreamState, web: string): Promise<void> {
  if (p === "/checkouts" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}") as Json;
    const cart = (body.product_cart as { product_id: string }[] | undefined) ?? [];
    const customer = (body.customer ?? {}) as { customer_id?: string; email?: string; name?: string };
    let customerId = customer.customer_id ?? null;
    let email = customer.email ?? null;
    if (customerId) {
      email = [...state.customers.entries()].find(([, id]) => id === customerId)?.[0] ?? email ?? "unknown@example.test";
    } else if (email) {
      customerId = state.customers.get(email.toLowerCase()) ?? `cus_mock_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      state.customers.set(email.toLowerCase(), customerId);
    }
    if (!customerId || !email || !cart[0]?.product_id || typeof body.return_url !== "string") {
      return json(res, 422, { code: "INVALID_REQUEST", message: "product_cart, customer and return_url are required" });
    }
    const id = `cks_mock_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const sub = body.subscription_data as { trial_period_days?: number } | undefined;
    state.sessions.set(id, {
      id,
      customerId,
      email,
      name: customer.name ?? null,
      productId: cart[0].product_id,
      trialDays: sub?.trial_period_days ?? 0,
      metadata: (body.metadata as Record<string, string>) ?? {},
      returnUrl: body.return_url,
      paid: false,
      subscriptionId: null,
    });
    const self = `http://${req.headers.host}`;
    return json(res, 200, { session_id: id, checkout_url: `${self}/dodo/pay/${id}` });
  }
  const pay = /^\/pay\/([A-Za-z0-9_]+)$/.exec(p);
  if (pay && req.method === "GET") {
    const s = state.sessions.get(pay[1]!);
    if (!s) return json(res, 404, { code: "NOT_FOUND" });
    const back = new URL(s.returnUrl);
    const control = state.dodoControlFor(s.email);
    if (control.decline) {
      back.searchParams.set("status", "failed");
    } else {
      if (!s.subscriptionId) {
        const subscription = newSubscription(s);
        if (control.pendingUntilWebhook) subscription.status = "pending";
        state.subscriptions.set(subscription.subscription_id, subscription);
        s.subscriptionId = subscription.subscription_id;
        s.paid = true;
        if (control.webhook) {
          setTimeout(() => void deliverWebhook(web, "subscription.active", subscription, state), control.webhookDelayMs);
        }
      }
      back.searchParams.set("subscription_id", s.subscriptionId);
      back.searchParams.set("status", "active");
    }
    res.writeHead(302, { location: back.toString() });
    res.end();
    return;
  }
  const session = /^\/checkouts\/([A-Za-z0-9_]+)$/.exec(p);
  if (session && req.method === "GET") {
    const s = state.sessions.get(session[1]!);
    if (!s) return json(res, 404, { code: "NOT_FOUND" });
    return json(res, 200, { id: s.id, payment_status: s.paid ? "succeeded" : null, customer_email: s.email });
  }
  if (p === "/subscriptions" && req.method === "GET") {
    const customerId = url.searchParams.get("customer_id");
    const items = [...state.subscriptions.values()].filter((s) => !customerId || s.customer.customer_id === customerId);
    return json(res, 200, { items });
  }
  const sub = /^\/subscriptions\/([A-Za-z0-9_]+)$/.exec(p);
  if (sub) {
    const s = state.subscriptions.get(sub[1]!);
    if (!s) return json(res, 404, { code: "NOT_FOUND" });
    if (req.method === "GET") return json(res, 200, s);
    if (req.method === "PATCH") {
      const body = JSON.parse((await readBody(req)) || "{}") as Json;
      if (typeof body.cancel_at_next_billing_date === "boolean") s.cancel_at_next_billing_date = body.cancel_at_next_billing_date;
      return json(res, 200, s);
    }
  }
  json(res, 404, { code: "NOT_FOUND" });
}

// ── server ────────────────────────────────────────────────────────────────────────────────────────────────────────
export function createUpstreamServer(options: { web?: string; state?: UpstreamState } = {}): { server: Server; state: UpstreamState } {
  const state = options.state ?? new UpstreamState();
  const web = (options.web ?? "http://localhost:3000").replace(/\/$/, "");
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const p = url.pathname;
      if (p === "/__health") return json(res, 200, { ok: true });
      if ((p === "/__mock/state" || p === "/__control") && req.method === "GET") {
        return json(res, 200, {
          maxConcurrency: state.maxConcurrency,
          authOnExport: state.authOnExport,
          requests: state.requests.slice(-3000),
          revoked: state.revoked,
          revokedUsers: state.revokedUsers,
          lichess: state.lichess,
          dodo: state.dodo,
          // No email addresses in the state dump (the customer is identified by its id).
          sessions: [...state.sessions.values()].map((s) => ({ id: s.id, customerId: s.customerId, productId: s.productId, trialDays: s.trialDays, paid: s.paid, subscriptionId: s.subscriptionId })),
          subscriptions: [...state.subscriptions.values()].map((s) => ({ id: s.subscription_id, status: s.status })),
          webhooks: state.webhooks,
        });
      }
      if (p === "/__mock/reset" && req.method === "POST") {
        state.reset();
        return json(res, 200, { ok: true });
      }
      if (p === "/__mock/fault" && req.method === "POST") {
        const b = JSON.parse((await readBody(req)) || "{}") as { provider?: Provider; status?: number; times?: number; match?: string; clear?: boolean };
        if (b.clear) state.faults = state.faults.filter((f) => f.provider !== b.provider);
        else if (b.provider && b.status) {
          state.faults.push({ provider: b.provider, status: b.status, times: b.times ?? 1_000_000, match: b.match ? new RegExp(b.match) : null });
        }
        return json(res, 200, { faults: state.faults.length });
      }
      if (p === "/__mock/delay" && req.method === "POST") {
        const b = JSON.parse((await readBody(req)) || "{}") as { provider?: Provider; ms?: number; match?: string; clear?: boolean };
        if (b.clear) {
          const source = b.match ? new RegExp(b.match).source : null;
          state.delays = state.delays.filter((d) => !(d.provider === b.provider && (source === null || d.match.source === source)));
        }
        else if (b.provider && b.ms && b.match) state.delays.push({ provider: b.provider, ms: Math.min(b.ms, 30_000), match: new RegExp(b.match) });
        return json(res, 200, { delays: state.delays.length });
      }
      if (p === "/__mock/lichess" && req.method === "POST") {
        Object.assign(state.lichess, JSON.parse((await readBody(req)) || "{}"));
        return json(res, 200, state.lichess);
      }
      if (p === "/__mock/dodo" && req.method === "POST") {
        const b = JSON.parse((await readBody(req)) || "{}") as Partial<DodoControl> & { email?: string; clear?: boolean };
        const { email, clear, ...control } = b;
        if (email) {
          const key = email.toLowerCase();
          if (clear) state.dodoFor.delete(key);
          else state.dodoFor.set(key, { ...(state.dodoFor.get(key) ?? {}), ...control });
          return json(res, 200, state.dodoControlFor(key));
        }
        Object.assign(state.dodo, control);
        return json(res, 200, state.dodo);
      }
      if (p === "/__control" && req.method === "POST") {
        const b = JSON.parse((await readBody(req)) || "{}") as {
          reset?: boolean;
          fault?: { provider: Provider; status: number; times?: number; match?: string };
          lichess?: Partial<UpstreamState["lichess"]>;
          dodo?: Partial<DodoControl>;
        };
        if (b.reset) state.reset();
        if (b.fault) state.faults.push({ provider: b.fault.provider, status: b.fault.status, times: b.fault.times ?? 1_000_000, match: b.fault.match ? new RegExp(b.fault.match) : null });
        if (b.lichess) Object.assign(state.lichess, b.lichess);
        if (b.dodo) Object.assign(state.dodo, b.dodo);
        return json(res, 200, { ok: true });
      }
      const m = /^\/(chesscom|lichess|dodo)(-worker)?(\/.*)$/.exec(p);
      if (!m) return json(res, 404, { error: "unknown upstream" });
      const provider = m[1] as Provider;
      const caller: Caller = m[2] ? "worker" : "web";
      const rest = m[3]!;
      state.requests.push({ provider, caller, method: req.method ?? "GET", path: rest, at: Date.now(), userAgent: req.headers["user-agent"] ?? null });
      const fault = state.faults.find((f) => f.provider === provider && f.times > 0 && (!f.match || f.match.test(rest)));
      if (fault && !(provider === "dodo" && rest.startsWith("/pay/"))) {
        fault.times--;
        return json(res, fault.status, { error: "mock fault" }, fault.status === 429 ? { "retry-after": "30" } : {});
      }
      const delay = state.delays.find((d) => d.provider === provider && d.match.test(rest));
      if (delay) await new Promise((r) => setTimeout(r, delay.ms));
      // Concurrency per provider and caller: the worker's gate must never have two requests open to one provider.
      const key = `${provider}:${caller}`;
      const open = (state.inflight.get(key) ?? 0) + 1;
      state.inflight.set(key, open);
      state.maxConcurrency[key] = Math.max(state.maxConcurrency[key] ?? 0, open);
      res.on("close", () => state.inflight.set(key, (state.inflight.get(key) ?? 1) - 1));
      if (provider === "chesscom") return chessCom(req, res, rest, caller);
      if (provider === "lichess") return lichess(req, res, rest, url, state);
      return dodo(req, res, rest, url, state, web);
    })().catch((error: unknown) => {
      if (!res.headersSent) json(res, 500, { error: String(error instanceof Error ? error.message : error).slice(0, 200) });
    });
  });
  return { server, state };
}

function argOf(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const port = Number(argOf("--port") ?? DEFAULT_UPSTREAM_PORT);
  const { server, state } = createUpstreamServer({ web: argOf("--web") });
  // Loopback only, on both families (`localhost` may resolve to ::1), sharing one state.
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`upstream mock on http://127.0.0.1:${port} (chesscom, lichess, dodo)\n`);
  });
  const v6 = createUpstreamServer({ web: argOf("--web"), state }).server;
  v6.on("error", () => process.stdout.write("upstream mock: no IPv6 loopback, 127.0.0.1 only\n"));
  v6.listen(port, "::1");
}
