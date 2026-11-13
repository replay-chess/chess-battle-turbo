// Chess.com Published-Data API client (phase-04 plan §7.8, §8.6; replaces WEB/lib/chess-com.ts). Anonymous, serial
// through a `ProviderGate` (R-CC-02: never `Promise.all`), `encodeURIComponent` on every handle, a User-Agent with a
// contact (R-CC-03), conditional GETs for archives and months (R-CC-04), an injectable base URL
// (`CHESSCOM_API_BASE`: the e2e upstream mock) and fetch, and per-caller timeouts (web 5 s; worker 8 s, months 15 s).
// No caching here: the web wraps it in `unstable_cache` (WEB/lib/accounts/chesscom.ts), the worker in its LRU.
import { describeIssues, ProviderError } from "../errors";
import { ProviderGate, type AcquireOptions } from "../gate";
import {
  getJson,
  normaliseBaseUrl,
  realClock,
  userAgent,
  type CallOptions,
  type Clock,
  type FetchLike,
  type HttpDeps,
  type Validators,
} from "../http";
import { isClosedStatus, previewOf } from "./map";
import {
  chessComSchemas,
  type ChessComPreviewData,
  type ChessComProfile,
  type ChessComStats,
  type MonthKey,
  type SchemaMode,
} from "./types";

export const CHESSCOM_API_BASE_DEFAULT = "https://api.chess.com";

/** Per-call timeouts in ms (§7.8). */
export const CHESSCOM_TIMEOUTS = {
  web: { profile: 5_000, stats: 5_000, archives: 5_000, month: 5_000 },
  worker: { profile: 8_000, stats: 8_000, archives: 8_000, month: 15_000 },
} as const;
export type CallerProfile = keyof typeof CHESSCOM_TIMEOUTS;

/** Chess.com handles: 3–25 letters, digits, `_` or `-`. */
export const CHESSCOM_USERNAME_RE = /^[A-Za-z0-9_-]{3,25}$/;

export interface ChessComClientOptions {
  baseUrl?: string;
  /** `UPSTREAM_CONTACT`. */
  contact?: string;
  fetch?: FetchLike;
  clock?: Clock;
  /** The process's Chess.com gate. Omitted: the client makes its own; `null`: the caller serialises. */
  gate?: ProviderGate | null;
  /** Which timeout column applies (§7.8). Default `worker`. */
  caller?: CallerProfile;
  /** `strict` only for the canary (§12.5b). */
  schemaMode?: SchemaMode;
}

export type ArchivesResult =
  | { status: 200; months: MonthKey[]; etag: string | null; lastModified: string | null }
  | { status: 304; etag: string | null; lastModified: string | null };

export type MonthResult =
  | { status: 200; games: unknown[]; etag: string | null; lastModified: string | null }
  | { status: 304; etag: string | null; lastModified: string | null };

/** Per-call options: the caller's abort signal and gate-wait cap (the worker lookup's 5 s, D4-23). */
export type ChessComCallOptions = CallOptions & Pick<AcquireOptions, "maxWaitMs">;

const MONTH_URL_RE = /\/games\/(\d{4})\/(\d{2})$/;

/** `…/games/2026/10` → `"2026/10"`; null for anything else. */
export function monthKeyOfArchiveUrl(url: string): MonthKey | null {
  const m = MONTH_URL_RE.exec(url);
  return m ? (`${Number(m[1])}/${m[2]}` as MonthKey) : null;
}

export class ChessComClient {
  readonly baseUrl: string;
  readonly gate: ProviderGate | null;
  private readonly deps: HttpDeps;
  private readonly timeouts: (typeof CHESSCOM_TIMEOUTS)[CallerProfile];
  private readonly mode: SchemaMode;

  constructor(opts: ChessComClientOptions = {}) {
    this.baseUrl = normaliseBaseUrl(opts.baseUrl ?? CHESSCOM_API_BASE_DEFAULT, "CHESSCOM_API_BASE");
    const clock = opts.clock ?? realClock;
    this.deps = {
      provider: "chesscom",
      fetch: opts.fetch ?? ((input, init) => fetch(input, init)),
      clock,
      userAgent: userAgent(opts.contact),
    };
    this.gate = opts.gate === undefined ? new ProviderGate({ provider: "chesscom", clock }) : opts.gate;
    this.timeouts = CHESSCOM_TIMEOUTS[opts.caller ?? "worker"];
    this.mode = opts.schemaMode ?? "lenient";
  }

  private playerPath(username: string): string {
    const u = username.trim();
    if (!CHESSCOM_USERNAME_RE.test(u)) throw new ProviderError("chesscom", "not_found", "not a Chess.com username");
    return `${this.baseUrl}/pub/player/${encodeURIComponent(u.toLowerCase())}`;
  }

  private call<T>(fn: () => Promise<T>, opts: ChessComCallOptions): Promise<T> {
    return this.gate ? this.gate.run(fn, { maxWaitMs: opts.maxWaitMs, signal: opts.signal }) : fn();
  }

  private parse<T>(
    schema: {
      safeParse(
        v: unknown,
      ): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; code: string }[] } };
    },
    body: unknown,
    what: string,
  ): T {
    const r = schema.safeParse(body);
    if (!r.success)
      throw new ProviderError(
        "chesscom",
        "bad_response",
        `chesscom ${what} does not match the schema (${describeIssues(r.error.issues)})`,
      );
    return r.data;
  }

  /** `GET /pub/player/{u}`. 404 → `not_found`; 410 or a `closed*` status → `closed`. */
  async getProfile(username: string, opts: ChessComCallOptions = {}): Promise<ChessComProfile> {
    const url = this.playerPath(username);
    const res = await this.call(() => getJson(this.deps, url, { timeoutMs: this.timeouts.profile, signal: opts.signal }), opts);
    if (res.status === 304) throw new ProviderError("chesscom", "bad_response", "unexpected 304 for a profile");
    const profile = this.parse(chessComSchemas(this.mode).profile, res.body, "profile");
    if (isClosedStatus(profile.status)) throw new ProviderError("chesscom", "closed", "the Chess.com account is closed");
    return profile;
  }

  /** `GET /pub/player/{u}/stats`. */
  async getStats(username: string, opts: ChessComCallOptions = {}): Promise<ChessComStats> {
    const url = `${this.playerPath(username)}/stats`;
    const res = await this.call(() => getJson(this.deps, url, { timeoutMs: this.timeouts.stats, signal: opts.signal }), opts);
    if (res.status === 304) throw new ProviderError("chesscom", "bad_response", "unexpected 304 for stats");
    return this.parse(chessComSchemas(this.mode).stats, res.body, "stats");
  }

  /** Profile, then stats, one after the other (R-CC-02); the stats call is skipped for a missing or closed account. */
  async getPreview(
    username: string,
    opts: ChessComCallOptions = {},
  ): Promise<{ profile: ChessComProfile; stats: ChessComStats; preview: ChessComPreviewData }> {
    const profile = await this.getProfile(username, opts);
    const stats = await this.getStats(username, opts);
    return { profile, stats, preview: previewOf(profile, stats) };
  }

  /** `GET /pub/player/{u}/games/archives` with the stored validators; months oldest first. */
  async getArchives(
    username: string,
    opts: ChessComCallOptions & { validators?: Validators } = {},
  ): Promise<ArchivesResult> {
    const url = `${this.playerPath(username)}/games/archives`;
    const res = await this.call(
      () =>
        getJson(this.deps, url, { timeoutMs: this.timeouts.archives, signal: opts.signal, validators: opts.validators }),
      opts,
    );
    if (res.status === 304) return res;
    const body = this.parse(chessComSchemas(this.mode).archives, res.body, "archives");
    const months: MonthKey[] = [];
    for (const u of body.archives) {
      const key = monthKeyOfArchiveUrl(u);
      if (!key) throw new ProviderError("chesscom", "bad_response", "an archive URL is not a month");
      months.push(key);
    }
    months.sort(compareMonthKeys);
    return { status: 200, months, etag: res.etag, lastModified: res.lastModified };
  }

  /** `GET /pub/player/{u}/games/{YYYY}/{MM}` with validators. Games are returned raw: map them one by one. */
  async getMonth(
    username: string,
    month: MonthKey,
    opts: ChessComCallOptions & { validators?: Validators } = {},
  ): Promise<MonthResult> {
    const m = /^(\d{4})\/(\d{2})$/.exec(month);
    if (!m) throw new RangeError(`not a month key: ${month}`);
    const url = `${this.playerPath(username)}/games/${m[1]}/${m[2]}`;
    const res = await this.call(
      () => getJson(this.deps, url, { timeoutMs: this.timeouts.month, signal: opts.signal, validators: opts.validators }),
      opts,
    );
    if (res.status === 304) return res;
    const body = this.parse(chessComSchemas(this.mode).month, res.body, "month");
    return { status: 200, games: body.games, etag: res.etag, lastModified: res.lastModified };
  }
}

/** Orders `"2025/12"` before `"2026/01"`. */
export function compareMonthKeys(a: string, b: string): number {
  const [ay, am] = a.split("/").map(Number) as [number, number];
  const [by, bm] = b.split("/").map(Number) as [number, number];
  return ay - by || am - bm;
}
