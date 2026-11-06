// Game e2e fixtures (phase-02 plan 12.6; WP-I). Specs under e2e/specs/game/** import `test` and `expect` from here.
//
//   test.use({ socketKind: "fast" });                 // TIMING_PROFILE=fast server (:3102); default: the app's :3002
//   test("…", async ({ seat, seedGame, telemetry }) => {
//     const a = await seat("A");                       // signed-in context + page, guarded, telemetry-recorded, linked
//     const b = await seat("B");
//     const g = await seedGame("G-PROMO", a, b);       // a fixture game (scripts/dev/seed-game-fixtures.ts)
//     await a.open(g.ref); await b.open(g.ref);
//     await a.move("b7b8n");
//   });
//
// Every seat context gets P1's console guard (`guardContext`) and the client telemetry recorder (events land in
// the same recorder `telemetry.expect()` reads); its socket.io traffic goes through `linkContext()` to the chosen
// server, so a spec can cut a player's network (`seat.link.setDown(true)`) without touching the others. Fixture games
// are created through @repo/db with the same writers the app uses, between two shared members (additive data only).
import { mergeTests, type BrowserContext, type BrowserContextOptions, type Page, type TestInfo } from "@playwright/test";
import type { PrismaClient } from "@repo/db";
import { test as authTest, signIn } from "./auth";
import { ChessBoardHelper } from "./chess-board";
import { finishGuard, guardContext } from "./console-guard";
import { isEventName } from "@repo/analytics";
import { auditEvents, expect, matchesProps, test as telemetryTest, type CapturedEvent, type ExpectOptions, type Match, type Telemetry } from "./telemetry";
import { letterEmail } from "./users";
import { FixtureSocketServer, linkContext, type SocketKind, type SocketLink } from "./socket-server";
import { assertFixtureTarget, resolveFixtureUser, seedGameFixture, type FixtureName } from "../../scripts/dev/seed-game-fixtures";

export { expect };

/** The primary design state (`data-phase`), the role and the ply the game screen exposes (GameBoardArea). */
export type Side = "w" | "b";

/** Console lines a live game legitimately produces (socket reconnects through a cut link, the restart window). */
export const GAME_CONSOLE_ALLOW: RegExp[] = [/WebSocket connection to '.*socket\.io.*' failed/, /net::ERR_CONNECTION_REFUSED/];

export interface Seat {
  letter: string;
  context: BrowserContext;
  page: Page;
  link: SocketLink;
  board: ChessBoardHelper;
  /** users.referenceId. */
  ref: string;
  /** Opens /game/<ref> and waits for the screen to leave `loading`. */
  open(gameRef: string): Promise<void>;
  phase(): Promise<string>;
  ply(): Promise<number>;
  color(): Promise<Side | null>;
  turn(): Promise<Side>;
  waitPhase(expected: string | RegExp, timeout?: number): Promise<void>;
  waitPly(n: number, timeout?: number): Promise<void>;
  /** Click-click move in UCI (`e2e4`, `b7b8n`); waits for this seat's turn first. */
  move(uci: string, opts?: { waitTurn?: boolean }): Promise<void>;
  /** Pointer drag from one square to another (a drop on a non-target square is reported as illegal). */
  drag(from: string, to: string): Promise<void>;
  /** Visible element by test id (desktop row or phone bar, whichever is visible). */
  byTestId(id: string): ReturnType<Page["locator"]>;
}

type SeatOptions = { viewport?: { width: number; height: number }; kind?: SocketKind; contextOptions?: BrowserContextOptions };

type GameFixtures = {
  /** Which socket server the seats talk to (option). */
  socketKind: SocketKind;
  seat: (letter: string, opts?: SeatOptions) => Promise<Seat>;
  /** `endedMinutesAgo` back-dates the fixture (G-ENDED older than ALREADY_ENDED_AFTER_MS → already_ended). */
  seedGame: (name: FixtureName, white: Seat, black: Seat, opts?: { endedMinutesAgo?: number }) => Promise<{ ref: string; id: bigint }>;
  /** The restartable :3103 server (game-serial project only). */
  restartable: FixtureSocketServer;
};

type WorkerFixtures = { gameDb: PrismaClient };

const INIT_SCRIPT = `(() => {
  if (window.__rcTelemetryInstalled) return;
  window.__rcTelemetryInstalled = true;
  const record = (item) => { try { window.__rcTelemetryRecord && window.__rcTelemetryRecord(item); } catch (e) {} };
  const wrap = (a) => { const push = Array.prototype.push; a.push = function (...items) { items.forEach(record); return push.apply(this, items); }; return a; };
  let arr = wrap([]);
  Object.defineProperty(window, "__rcTelemetry", {
    configurable: true,
    get() { return arr; },
    set(v) { if (Array.isArray(v)) { v.forEach(record); arr = wrap(v); } },
  });
})();`;

/** Mirrors telemetry.ts's client sink into the shared recorder (P1 keeps that helper private; same shape). */
async function recordClientTelemetry(context: BrowserContext, sinks: CapturedEvent[][]) {
  await context.exposeBinding("__rcTelemetryRecord", (source, item: unknown) => {
    if (!item || typeof item !== "object") return;
    const e = item as { event?: unknown; props?: unknown; ts?: unknown };
    if (typeof e.event !== "string") return;
    const captured: CapturedEvent = {
      source: "client",
      event: e.event,
      props: e.props && typeof e.props === "object" ? (e.props as Record<string, unknown>) : {},
      ts: typeof e.ts === "number" ? e.ts : Date.now(),
      url: source.page?.url(),
    };
    for (const sink of sinks) sink.push(captured);
  });
  await context.addInitScript({ content: INIT_SCRIPT });
}

const container = (p: Page) => p.locator('[data-testid="game-board-container"]');

export async function attr(p: Page, name: string): Promise<string | null> {
  return container(p).getAttribute(name);
}

function seatFor(letter: string, context: BrowserContext, page: Page, link: SocketLink, ref: string): Seat {
  const s: Seat = {
    letter,
    context,
    page,
    link,
    ref,
    board: new ChessBoardHelper(page),
    async open(gameRef) {
      await page.goto(`/game/${gameRef}`, { timeout: 180_000, waitUntil: "domcontentloaded" });
      await expect(container(page)).toBeVisible({ timeout: 120_000 });
      await expect.poll(async () => (await attr(page, "data-phase")) ?? "loading", { timeout: 90_000 }).not.toBe("loading");
    },
    async phase() {
      return (await attr(page, "data-phase")) ?? "";
    },
    async ply() {
      return Number(await attr(page, "data-ply"));
    },
    async color() {
      const c = await attr(page, "data-player-color");
      return c === "w" || c === "b" ? c : null;
    },
    async turn() {
      return (await attr(page, "data-current-turn")) as Side;
    },
    async waitPhase(expected, timeout = 30_000) {
      await expect(container(page)).toHaveAttribute("data-phase", expected, { timeout });
    },
    async waitPly(n, timeout = 30_000) {
      await expect(container(page)).toHaveAttribute("data-ply", String(n), { timeout });
    },
    async move(uci, opts = {}) {
      if (opts.waitTurn !== false) {
        const me = await s.color();
        if (me) await expect(container(page)).toHaveAttribute("data-current-turn", me, { timeout: 30_000 });
      }
      await page.locator(`[data-square="${uci.slice(0, 2)}"]`).click();
      await page.locator(`[data-square="${uci.slice(2, 4)}"]`).click();
      if (uci[4]) {
        const names: Record<string, string> = { q: "queen", r: "rook", b: "bishop", n: "knight" };
        await page.getByRole("menu", { name: "Choose a promotion piece" }).getByRole("menuitem", { name: `Promote to ${names[uci[4]]}` }).click();
      }
    },
    async drag(from, to) {
      const a = await page.locator(`[data-square="${from}"]`).boundingBox();
      const b = await page.locator(`[data-square="${to}"]`).boundingBox();
      if (!a || !b) throw new Error(`squares ${from}/${to} not on screen`);
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
      await page.mouse.up();
    },
    byTestId(id) {
      // Phones and iPad portrait render the control bar (`<id>-bar`, GameActionBar) instead of the row.
      // regression: REGRESSION-2 (webkit-iphone @smoke looked for the row's flip/hint buttons only).
      return page.locator(`[data-testid="${id}"]:visible, [data-testid="${id}-bar"]:visible`).first();
    },
  };
  return s;
}

/** The viewer's users.referenceId through GET /api/me (also provisions/onboards, as the auth fixture does). */
async function viewerRef(page: Page): Promise<string> {
  const res = await page.request.get("/api/me");
  const body = (await res.json()) as { data?: { user?: { ref?: string } } };
  const ref = body.data?.user?.ref;
  if (!ref) throw new Error(`GET /api/me gave no user ref (${res.status()})`);
  return ref;
}

export const test = mergeTests(authTest, telemetryTest).extend<GameFixtures, WorkerFixtures>({
  socketKind: ["main", { option: true }],

  gameDb: [
    // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructuring pattern here
    async ({}, provide) => {
      const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
      assertFixtureTarget(url);
      const { PrismaClient } = await import("@repo/db");
      const db = new PrismaClient({ datasourceUrl: url });
      await provide(db);
      await db.$disconnect();
    },
    { scope: "worker" },
  ],

  seat: async ({ browser, socketKind, allowConsole, consoleGuard, _telemetryRecorder }, provide, testInfo: TestInfo) => {
    const opened: { context: BrowserContext; problems: ReturnType<typeof guardContext> }[] = [];
    const clientEvents: CapturedEvent[] = [];
    await provide(async (letter, opts = {}) => {
      // Each seat signs in through Clerk and compiles pages on a busy `next dev`: give the test a minute per seat.
      testInfo.setTimeout(testInfo.timeout + 60_000);
      // A phone project (webkit-iphone in CI) gives its seats the phone; desktop projects get 1440 × 900.
      const use = testInfo.project.use;
      const device: BrowserContextOptions = use.isMobile
        ? { viewport: use.viewport ?? null, userAgent: use.userAgent, isMobile: true, hasTouch: use.hasTouch, deviceScaleFactor: use.deviceScaleFactor }
        : { viewport: { width: 1440, height: 900 } };
      const context = await browser.newContext({ ...device, ...(opts.viewport ? { viewport: opts.viewport } : {}), ...opts.contextOptions });
      const problems = consoleGuard === "off" ? [] : guardContext(context, [...GAME_CONSOLE_ALLOW, ...allowConsole]);
      opened.push({ context, problems });
      // Into the shared recorder (telemetry.expect sees seat events) and this fixture's list (audited below).
      await recordClientTelemetry(context, [_telemetryRecorder.client, clientEvents]);
      const link = await linkContext(context, opts.kind ?? socketKind);
      const page = await context.newPage();
      await signIn(page, letterEmail(letter), "");
      return seatFor(letter, context, page, link, await viewerRef(page));
    });
    for (const { context, problems } of opened) {
      await context.close().catch(() => undefined);
      await finishGuard(problems, testInfo, consoleGuard);
    }
    const audit = auditEvents(clientEvents, _telemetryRecorder.forbidden);
    if (audit.length && (testInfo.status === "passed" || testInfo.status === undefined)) {
      throw new Error(`telemetry (seats): ${audit.length} problem(s)\n${audit.join("\n")}`);
    }
  },

  seedGame: async ({ gameDb }, provide) => {
    await provide(async (name, white, black, opts = {}) => {
      const w = await resolveFixtureUser(gameDb, white.ref);
      const b = await resolveFixtureUser(gameDb, black.ref);
      const now = new Date(Date.now() - (opts.endedMinutesAgo ?? 0) * 60_000);
      const g = await seedGameFixture(gameDb, name, { white: w, black: b }, now);
      return { ref: g.ref, id: g.id };
    });
  },

  // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructuring pattern here
  restartable: async ({}, provide, testInfo) => {
    const server = new FixtureSocketServer("restartable");
    await server.start();
    await provide(server);
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach("restartable-socket.log", { body: server.output(), contentType: "text/plain" });
    }
    await server.stop("SIGTERM");
  },
});

// ─── Helpers shared by the specs ────────────────────────────────────────────────────────────────────────────────

/** Members of a game sorted by colour, after both joined. */
export async function byColor(a: Seat, b: Seat): Promise<Record<Side, Seat>> {
  await expect.poll(async () => (await a.color()) !== null && (await b.color()) !== null, { timeout: 60_000 }).toBe(true);
  const ca = (await a.color())!;
  expect(await b.color()).not.toBe(ca);
  return ca === "w" ? { w: a, b } : { w: b, b: a };
}

/** Plays UCI moves alternately by colour, starting with whoever is to move; waits for each ply on both seats. */
export async function playLine(seats: Record<Side, Seat>, line: readonly string[]): Promise<void> {
  for (const uci of line) {
    const turn = await seats.w.turn();
    const mover = seats[turn];
    const before = await mover.ply();
    await mover.move(uci);
    await seats.w.waitPly(before + 1);
    await seats.b.waitPly(before + 1);
  }
}

/** A friend challenge through the legacy writer (createLiveGame), as /play does. Returns the game ref. */
export async function createFriendGame(
  creator: Seat,
  opts: { initialTimeSeconds?: number; incrementSeconds?: number; legendRef?: string | null } = {},
): Promise<string> {
  const res = await creator.page.request.post("/api/chess/create-game", {
    data: {
      userReferenceId: creator.ref,
      initialTimeSeconds: opts.initialTimeSeconds ?? 300,
      incrementSeconds: opts.incrementSeconds ?? 3,
      gameMode: "friend",
      playAsLegend: Boolean(opts.legendRef),
      selectedLegend: opts.legendRef ?? null,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()) as { data?: { game?: { referenceId?: string } } };
  const ref = body.data?.game?.referenceId;
  if (!ref) throw new Error("create-game returned no ref");
  return ref;
}

/** Joins a friend challenge through the join page (T2) and lands on the game. */
export async function joinViaLink(joiner: Seat, ref: string): Promise<void> {
  try {
    await joiner.page.goto(`/join/${ref}`, { timeout: 180_000 });
  } catch (err) {
    // A client redirect that starts while the document loads aborts goto (`net::ERR_ABORTED`); the page is fine.
    if (!String(err).includes("ERR_ABORTED")) throw err;
    await joiner.page.waitForLoadState("domcontentloaded");
  }
  if (!/\/game\//.test(joiner.page.url())) {
    await joiner.page.locator('[data-testid="accept-challenge-button"]').click({ timeout: 90_000 });
    await joiner.page.waitForURL(/\/game\//, { timeout: 120_000, waitUntil: "commit" });
  }
  await expect(container(joiner.page)).toBeVisible({ timeout: 120_000 });
}

/** The first featured legend (for the study phase). */
export async function firstLegendRef(seat: Seat): Promise<string> {
  const res = await seat.page.request.get("/api/legends");
  const body = (await res.json()) as { data: { legends: { referenceId: string }[] } };
  const ref = body.data.legends[0]?.referenceId;
  if (!ref) throw new Error("no legends on this database (seed:content)");
  return ref;
}

/** Both players attach to a seeded WAITING fixture and the game starts (study 0 → first_move). */
export async function startSeeded(white: Seat, black: Seat, ref: string): Promise<void> {
  await Promise.all([white.open(ref), black.open(ref)]);
  await expect.poll(async () => (await attr(white.page, "data-game-started")) === "true", { timeout: 60_000 }).toBe(true);
}

/** The game snapshot from GET /api/games/[ref] (as the viewer). */
export async function snapshot(seat: Seat, ref: string) {
  const res = await seat.page.request.get(`/api/games/${ref}`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { data: { snapshot: Record<string, unknown> & { status: string; result?: { method?: string; winner?: string | null } } } }).data.snapshot;
}

/** Last server event of a type the seat received through its link (`42["<event>",{…}]` frames). */
export function lastServerEvent<T = Record<string, unknown>>(seat: Seat, event: string): T | null {
  const prefix = `42["${event}",`;
  for (let i = seat.link.frames().length - 1; i >= 0; i--) {
    const f = seat.link.frames()[i]!;
    if (f.startsWith(prefix)) return (JSON.parse(f.slice(2)) as [string, T])[1];
  }
  return null;
}

/**
 * `telemetry.expect()` for a plan 10.1 event. While the event is not yet in @repo/analytics (its sender is not built),
 * the test records a `telemetry-pending` annotation instead of failing; once registered, the assertion is enforced.
 */
export async function planEvent(telemetry: Telemetry, name: string, match?: Match, options?: ExpectOptions): Promise<void> {
  if (!isEventName(name)) {
    test.info().annotations.push({ type: "telemetry-pending", description: `${name} is not registered in @repo/analytics (plan 10.1)` });
    return;
  }
  await telemetry.expect(name, match, options);
}

/** Commands this seat sent through its link (`42<ack>["<name>",{…}]`), parsed. */
export function sentCommands(seat: Seat, name: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const f of seat.link.sent()) {
    const m = /^42\d*(\[.*)$/s.exec(f);
    if (!m) continue;
    try {
      const [event, payload] = JSON.parse(m[1]!) as [string, Record<string, unknown>];
      if (event === name) out.push(payload);
    } catch {
      // not JSON
    }
  }
  return out;
}

/** Polls GET /api/games/[ref] until the finish has been written (the socket writes it after the room event). */
export async function finishedSnapshot(seat: Seat, ref: string, status: "COMPLETED" | "ABORTED" = "COMPLETED") {
  await expect.poll(async () => (await snapshot(seat, ref)).status, { timeout: 20_000 }).toBe(status);
  return snapshot(seat, ref);
}

/**
 * Server events (the PostHog sink) of one name sent for these players (`distinct_id` = users.referenceId), so games
 * other workers play at the same time are not counted. Polls until exactly `count` match, then stays 1 s to catch a
 * late duplicate.
 */
export async function expectServerEvents(
  telemetry: Telemetry,
  name: string,
  players: readonly Seat[],
  count: number,
  match?: Match,
): Promise<CapturedEvent[]> {
  const refs = new Set(players.map((p) => p.ref));
  const find = async () =>
    (await telemetry.events("server")).filter((e) => e.event === name && refs.has(e.distinctId ?? "") && matchesProps(e.props, match));
  await expect.poll(async () => (await find()).length, { timeout: 20_000, message: `server event ${name} ×${count}` }).toBe(count);
  await new Promise((r) => setTimeout(r, 1_000));
  const found = await find();
  expect(found, `server event ${name} exactly ${count}×`).toHaveLength(count);
  return found;
}

/**
 * One acked socket command from the test process with a viewer's token (`GET /api/socket-token`), against the app's
 * socket (or `port`). Resolves with the ack, or `{connectError}` when the handshake is refused.
 */
export async function socketCommand(token: string | undefined, event: string, payload: unknown, opts: { port?: number; proto?: 2 | null } = {}): Promise<unknown> {
  const { io } = await import("socket.io-client");
  const auth: Record<string, unknown> = { token };
  if (opts.proto !== null) auth.proto = opts.proto ?? 2;
  return new Promise((resolve) => {
    const s = io(`ws://127.0.0.1:${opts.port ?? 3002}`, { transports: ["websocket"], auth, reconnection: false, timeout: 10_000 });
    const done = (v: unknown) => {
      s.disconnect();
      resolve(v);
    };
    s.on("connect", () => s.emit(event, payload, (ack: unknown) => done(ack)));
    s.on("connect_error", (e: Error) => done({ connectError: e.message }));
    setTimeout(() => done({ timeout: true }), 15_000);
  });
}
