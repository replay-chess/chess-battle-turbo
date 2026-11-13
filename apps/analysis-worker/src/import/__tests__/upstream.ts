// An in-process upstream for the import tests (phase-04 plan §12.2 "mock upstream"): Chess.com's published-data API
// and Lichess's game export, served from @repo/chess-fixtures/import as a `fetch` the worker's provider clients take
// (providers/index.ts `fetch`). It speaks what the clients speak (ETag / Last-Modified with 304s, NDJSON streams,
// 429 with Retry-After, 503), records every request with its headers, counts concurrent requests per provider (the
// "never two concurrent requests to one provider" rule is asserted from here) and lets a test fail a request or
// change the data between runs. Game ids get a per-instance `tag` so test files never share an external id.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { FetchLike } from "@repo/chess-import/http";

const require = createRequire(import.meta.url);
const fixture = (rel: string) => readFileSync(require.resolve(`@repo/chess-fixtures/import/${rel}`), "utf8");

export type MockProvider = "chesscom" | "lichess";
export const CHESSCOM_BASE = "http://upstream.test/chesscom";
export const LICHESS_BASE = "http://upstream.test/lichess";

export interface RecordedRequest {
  provider: MockProvider;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
}

/** A failure the next matching request gets (`times` requests, default 1). */
export interface MockFault {
  provider: MockProvider;
  /** Matches the request path (e.g. /games\/2026\/09$/). */
  match?: RegExp;
  status: 429 | 500 | 503;
  retryAfterSec?: number;
  times?: number;
}

type Json = Record<string, unknown>;

export interface ChessComAccount {
  profile: Json;
  /** "YYYY/MM" → raw archive games (oldest first, as Chess.com serves them). */
  months: Map<string, Json[]>;
  /** Bumped whenever the account's data changes (ETag of archives and months). */
  version: number;
}

export interface LichessAccount {
  /** Export lines, newest first by createdAt; strings are sent as they are (a malformed line). */
  lines: (Json | string)[];
}

export class FakeUpstream {
  readonly requests: RecordedRequest[] = [];
  readonly faults: MockFault[] = [];
  readonly chesscom = new Map<string, ChessComAccount>();
  readonly lichess = new Map<string, LichessAccount>();
  private active: Record<MockProvider, number> = { chesscom: 0, lichess: 0 };
  readonly maxActive: Record<MockProvider, number> = { chesscom: 0, lichess: 0 };
  /** Called before a matching request is answered (a test deletes rows, kills a connection, …). */
  readonly before: { match: RegExp; once: boolean; run: () => Promise<void> | void }[] = [];
  /** Real milliseconds every JSON answer waits (makes overlapping requests likely in the concurrency tests). */
  latencyMs = 0;
  /** Lichess export: stop with a stream error after this many lines of the next stream (one-shot). */
  breakLichessAfter: number | null = null;
  /** Lichess export pacing on the test clock: each line advances it (20 games/s = 50 ms). */
  lichessPace: { advance: (ms: number) => Promise<void>; msPerLine: number } | null = null;

  /** `tag`: digits, unique per instance (appended to Chess.com game ids; Lichess ids are rebuilt from it). */
  constructor(readonly tag: string) {
    if (!/^\d{1,12}$/.test(tag)) throw new Error("the upstream tag is 1–12 digits");
  }

  /** An 8-character Lichess game id (the export schema's shape), unique per instance and index (< 36³ = 46,656). */
  lichessId(i: number): string {
    if (!Number.isInteger(i) || i < 0 || i >= 36 ** 3) throw new RangeError("a mock Lichess game index is 0..46655");
    const prefix = BigInt(this.tag).toString(36).slice(-5).padStart(5, "0");
    return `${prefix}${i.toString(36).padStart(3, "0")}`;
  }

  // ── data ────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** The knightowl_88 fixture account (3 months, 48 games) under `username`, game ids tagged. */
  addChessComFixture(username = "knightowl_88"): ChessComAccount {
    const profile = JSON.parse(fixture("chesscom/knightowl_88/profile.json")) as Json;
    const months = new Map<string, Json[]>();
    for (const m of ["2026-08", "2026-09", "2026-10"]) {
      const body = JSON.parse(fixture(`chesscom/knightowl_88/${m}.json`)) as { games: Json[] };
      months.set(
        m.replace("-", "/"),
        body.games.map((g) => this.tagChessCom(username.toLowerCase() === "knightowl_88" ? g : this.renameMember(g, username))),
      );
    }
    const acc = { profile: { ...profile, username: username.toLowerCase() }, months, version: 1 };
    this.chesscom.set(username.toLowerCase(), acc);
    return acc;
  }

  /**
   * A heavy account: `perMonth` games in each of the `months` months up to (and excluding) `nowMs`'s month, copied
   * from the fixture games with their own ids and end times spread over the month (the bench / statement budget).
   */
  addChessComMany(username: string, nowMs: number, months: number, perMonth: number): ChessComAccount {
    const fx = this.addChessComFixture(username);
    const pool = [...fx.months.values()].flat();
    const out = new Map<string, Json[]>();
    const d = new Date(nowMs);
    let n = 0;
    for (let k = months; k >= 1; k--) {
      const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k, 1);
      const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k + 1, 1);
      const key = `${new Date(start).getUTCFullYear()}/${String(new Date(start).getUTCMonth() + 1).padStart(2, "0")}`;
      const games: Json[] = [];
      for (let i = 0; i < perMonth; i++) {
        const g = pool[n % pool.length]!;
        const id = `${900000000 + n}${this.tag}`;
        n++;
        games.push({
          ...g,
          url: String(g.url).replace(/\d+$/, id),
          uuid: `bulk-${id}`,
          end_time: Math.floor((start + ((i + 1) * (end - start)) / (perMonth + 1)) / 1000),
        });
      }
      out.set(key, games);
    }
    fx.months = out;
    return fx;
  }

  /** An account that holds only the games `of` played against `opponent` (both members import the same games). */
  addChessComOpponent(of: ChessComAccount, opponent: string): ChessComAccount {
    const months = new Map<string, Json[]>();
    for (const [k, games] of of.months) {
      const mine = games.filter((g) =>
        ["white", "black"].some((s) => ((g[s] as Json).username as string).toLowerCase() === opponent.toLowerCase()),
      );
      if (mine.length) months.set(k, mine);
    }
    const acc = { profile: { ...of.profile, username: opponent.toLowerCase(), player_id: 777_000_001 }, months, version: 1 };
    this.chesscom.set(opponent.toLowerCase(), acc);
    return acc;
  }

  /** The fixture games with the member's side renamed (another account holding the same games). */
  private renameMember(g: Json, username: string): Json {
    const side = (s: Json) => (String(s.username).toLowerCase() === "knightowl_88" ? { ...s, username } : s);
    return { ...g, white: side(g.white as Json), black: side(g.black as Json) };
  }

  private tagChessCom(g: Json): Json {
    const url = String(g.url).replace(/(\d+)$/, `$1${this.tag}`);
    return { ...g, url, uuid: `${String(g.uuid)}-${this.tag}` };
  }

  /** The knightowl88 fixture export (30 lines + 1 malformed) under `username`, game ids tagged. */
  addLichessFixture(username = "knightowl88"): LichessAccount {
    const raw = fixture("lichess/knightowl88/games.ndjson").split("\n").filter((l) => l.trim() !== "");
    const lines = raw.map((l, i) => {
      try {
        const g = JSON.parse(l) as Json;
        return { ...g, id: this.lichessId(i) };
      } catch {
        return l;
      }
    });
    const acc = { lines };
    this.lichess.set(username.toLowerCase(), acc);
    return acc;
  }

  /**
   * A large export built from the fixture's valid lines: `n` games, newest first, each a copy with its own id and
   * times `stepMs` apart, the newest created at `newestMs`.
   */
  addLichessMany(username: string, n: number, newestMs: number, stepMs = 3_600_000): LichessAccount {
    const base = fixture("lichess/knightowl88/games.ndjson")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .flatMap((l) => {
        try {
          const g = JSON.parse(l) as Json;
          return g.status === "aborted" || g.status === "started" ? [] : [g];
        } catch {
          return [];
        }
      });
    const lines: Json[] = [];
    for (let i = 0; i < n; i++) {
      const g = base[i % base.length]!;
      const created = newestMs - i * stepMs;
      const length = Number(g.lastMoveAt) - Number(g.createdAt);
      lines.push({ ...g, id: this.lichessId(i), createdAt: created, lastMoveAt: created + length });
    }
    const acc = { lines };
    this.lichess.set(username.toLowerCase(), acc);
    return acc;
  }

  // ── transport ───────────────────────────────────────────────────────────────────────────────────────────────────
  readonly fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    const provider: MockProvider = url.href.startsWith(CHESSCOM_BASE) ? "chesscom" : "lichess";
    const path = url.pathname.replace(/^\/(chesscom|lichess)/, "");
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k] = v));
    this.requests.push({ provider, path, query: url.searchParams, headers });
    this.active[provider]++;
    this.maxActive[provider] = Math.max(this.maxActive[provider], this.active[provider]);
    let streaming = false;
    try {
      for (const b of [...this.before]) {
        if (!b.match.test(path)) continue;
        if (b.once) this.before.splice(this.before.indexOf(b), 1);
        await b.run();
      }
      if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
      const fault = this.faults.find((f) => f.provider === provider && (!f.match || f.match.test(path)));
      if (fault) {
        fault.times = (fault.times ?? 1) - 1;
        if (fault.times <= 0) this.faults.splice(this.faults.indexOf(fault), 1);
        return new Response(fault.status === 429 ? "Too Many Requests" : "upstream down", {
          status: fault.status,
          headers: fault.retryAfterSec !== undefined ? { "retry-after": String(fault.retryAfterSec) } : {},
        });
      }
      if (provider === "chesscom") return this.chesscomAnswer(path, headers);
      streaming = true;
      return this.lichessAnswer(path, url.searchParams, () => this.active.lichess--);
    } finally {
      if (!streaming) this.active[provider]--;
    }
  };

  private chesscomAnswer(path: string, headers: Record<string, string>): Response {
    const m = /^\/pub\/player\/([^/]+)(\/stats|\/games\/archives|\/games\/(\d{4})\/(\d{2}))?$/.exec(path);
    const acc = m ? this.chesscom.get(decodeURIComponent(m[1]!)) : undefined;
    if (!m || !acc) return new Response(JSON.stringify({ code: 0, message: "not found" }), { status: 404 });
    const json = (body: unknown, etag: string) => {
      if (headers["if-none-match"] === etag) return new Response(null, { status: 304, headers: { etag } });
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", etag } });
    };
    if (!m[2]) return json(acc.profile, `"p-${acc.version}"`);
    if (m[2] === "/stats") return json({}, `"s-${acc.version}"`);
    if (m[2] === "/games/archives") {
      const keys = [...acc.months.keys()].sort();
      return json({ archives: keys.map((k) => `https://api.chess.com/pub/player/${m[1]}/games/${k}`) }, `"a-${acc.version}"`);
    }
    const key = `${m[3]}/${m[4]}`;
    const games = acc.months.get(key);
    if (!games) return new Response(JSON.stringify({ games: [] }), { status: 200 });
    return json({ games }, `"m-${key}-${acc.version}"`);
  }

  private lichessAnswer(path: string, q: URLSearchParams, done: () => void): Response {
    const m = /^\/api\/games\/user\/([^/]+)$/.exec(path);
    const acc = m ? this.lichess.get(decodeURIComponent(m[1]!)) : undefined;
    if (!m || !acc) {
      done();
      return new Response("not found", { status: 404 });
    }
    const since = q.has("since") ? Number(q.get("since")) : Number.NEGATIVE_INFINITY;
    const until = q.has("until") ? Number(q.get("until")) : Number.POSITIVE_INFINITY;
    const max = q.has("max") ? Number(q.get("max")) : Number.POSITIVE_INFINITY;
    // `perfType` as Lichess applies it: only games of the listed speeds (the correspondence look-back, FIX-1).
    const speeds = q.has("perfType") ? new Set(q.get("perfType")!.split(",")) : null;
    const selected: string[] = [];
    for (const l of acc.lines) {
      if (typeof l === "string") {
        // A malformed line belongs to no speed: only the full export carries it.
        if (!speeds || speeds.size > 1) selected.push(l);
        continue;
      }
      const created = Number(l.createdAt);
      if (created < since || created > until) continue;
      if (speeds && !speeds.has(String(l.speed ?? l.perf ?? ""))) continue;
      if (selected.filter((s) => s.startsWith("{")).length >= max) break;
      selected.push(JSON.stringify(l));
    }
    const breakAfter = this.breakLichessAfter;
    this.breakLichessAfter = null;
    const pace = this.lichessPace;
    const enc = new TextEncoder();
    let i = 0;
    let closed = false;
    const finish = () => {
      if (!closed) {
        closed = true;
        done();
      }
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(ctl) {
        if (breakAfter !== null && i >= breakAfter) {
          finish();
          ctl.error(new Error("connection reset by the mock"));
          return;
        }
        if (i >= selected.length) {
          finish();
          ctl.close();
          return;
        }
        if (pace) await pace.advance(pace.msPerLine);
        ctl.enqueue(enc.encode(`${selected[i++]}\n`));
      },
      cancel() {
        finish();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } });
  }

  /** Requests to one provider (optionally only those whose path matches). */
  to(provider: MockProvider, match?: RegExp): RecordedRequest[] {
    return this.requests.filter((r) => r.provider === provider && (!match || match.test(r.path)));
  }
}
