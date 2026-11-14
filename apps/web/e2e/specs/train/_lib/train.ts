// Phase 5 e2e helpers (phase-05 plan §12.4; testing X4–X8). Every spec under e2e/specs/train/** imports `test` and
// `expect` from here: the P3 review fixtures (`member`, `userPage`, `persona`, `reviewDb`, the console guard and the
// telemetry recorder) plus what the trainer specs share:
//
//   - the runner on screen: `currentItem`, `solveItem`, `wrongMove`, `grade`, `suggested`, `hint`, `showSolution`;
//   - the session payload (`sessionPayload`: the items with their solutions, read through the member's own GET);
//   - database reads scoped to the leased pool user (`trainDb`): attempts, cards, days, profile;
//   - server time for every same-origin request of a page (`serverClock`: documents, RSC and /api carry `x-rc-now`);
//   - a signed `/internal/emit` to the member's user room (`emitToUser`, home-backlog);
//   - a bot game in the browser with blunders the fake engine grades (game-over-bank-line).
//
// Solutions are never sent to telemetry: `forbidSolutions(telemetry, items)` registers every solution SAN with the PII
// guard (plan §10.1).
import { randomUUID } from "node:crypto";
import type { APIRequestContext, Locator, Page, TestInfo } from "@playwright/test";
import { Chess, type Move } from "chess.js";
import type { PrismaClient } from "@repo/db";
import { poolEmail, poolSlot } from "../../../fixtures/users";
import { serverNowHeaders } from "../../../fixtures/time";
import type { Telemetry } from "../../../fixtures/telemetry";
import { expect, test, gotoOk, DEVICES, hideDevOverlay, type DeviceName } from "../../review/_lib/review";

export { expect, test, gotoOk, DEVICES, hideDevOverlay, type DeviceName };

// ── Design-state tags ──────────────────────────────────────────────────────────────────────────────────────────
/**
 * The desktop boards that draw one screen in several highlighted states enumerate every state of that screen
 * (docs/qa/design-states.json): a spec that reaches a state reaches it on each of them (the P2/P3 pattern).
 */
export const BOARDS = {
  hub: ["V3TrainHub", "V3TrainHubDone", "V3TrainHubLoading"],
  bank: ["V3MistakeBank"],
  bankStates: ["V3BankEmpty", "V3BankCaughtUp", "V3BankLoading"],
  runner: ["V3BankSession"],
  puzzle: ["V3PuzzleSolve", "V3PuzzleHint", "V3PuzzleWrong", "V3PuzzleCorrect", "V3PuzzleSolution", "V3PuzzleThemes"],
  summary: ["V3SessionSummary", "V3SessionPerfect"],
  home: ["V3Home", "V3HomeNewUser", "V3HomeLoading"],
} as const;

export type BoardGroup = keyof typeof BOARDS;

/** `@state:` (real data) tags for states of a board group. */
export function stateTags(group: BoardGroup, ...states: string[]): string[] {
  return states.flatMap((s) => BOARDS[group].map((b) => `@state:${b}.${s}`));
}

/** The device boards a phone/tablet spec reaches (V3iPhonePuzzle, V3AndroidTrainHub, …). */
export function deviceStateTags(device: DeviceName, board: "Bank" | "MistakeBank" | "Puzzle" | "TrainHub", ...states: string[]): string[] {
  const prefix = { iphone: "V3iPhone", android: "V3Android", "ipad-portrait": "V3iPadP", "ipad-landscape": "V3iPadL", "desktop-1440": null }[device];
  return prefix ? states.map((s) => `@state:${prefix}${board}.${s}`) : [];
}

// ── The leased pool user ──────────────────────────────────────────────────────────────────────────────────────
/** The pool user `persona(name)` signs in as (slot 0 of this worker). */
export function poolUserEmail(testInfo: TestInfo, index = 0): string {
  return poolEmail(poolSlot(testInfo.parallelIndex, index));
}

/** The signed-in member's ref (users.referenceId), from GET /api/me. */
export async function viewerRef(page: Page): Promise<string> {
  const res = await page.request.get("/api/me", { headers: { accept: "application/json" } });
  expect(res.status(), "GET /api/me").toBe(200);
  const ref = ((await res.json()) as { data?: { user?: { ref?: string } } }).data?.user?.ref;
  expect(ref, "the member's ref").toBeTruthy();
  return ref!;
}

// ── Database reads (the e2e database only: reviewDb refuses anything but a local Postgres or the Neon dev branch) ─
export type TrainDb = {
  userId(email: string): Promise<bigint>;
  attempts(userId: bigint): Promise<{ n: number; distinct: number }>;
  attemptsOfSession(sessionRef: string): Promise<number>;
  bankCards(userId: bigint): Promise<number>;
  dueBankCards(userId: bigint, at: Date): Promise<number>;
  day(userId: bigint, day: string): Promise<{ bankReviewed: number; puzzlesDone: number; planDone: number; hasPlan: boolean } | null>;
  days(userId: bigint): Promise<string[]>;
  profile(userId: bigint): Promise<{ dayStreak: number; lastActiveDay: string | null; puzzleRating: number } | null>;
  firstBankCard(userId: bigint): Promise<{ itemKey: string; due: Date }>;
  raw: PrismaClient;
};

export function trainDb(db: PrismaClient): TrainDb {
  const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
  return {
    raw: db,
    async userId(email) {
      const rows = await db.$queryRaw<{ id: bigint }[]>`SELECT id FROM users WHERE lower(email) = lower(${email}) LIMIT 1`;
      if (!rows[0]) throw new Error(`no users row for ${email}`);
      return rows[0].id;
    },
    async attempts(userId) {
      const [r] = await db.$queryRaw<{ n: bigint; d: bigint }[]>`
        SELECT count(*) AS n, count(DISTINCT "clientAttemptId") AS d FROM training_attempts WHERE "userId" = ${userId}`;
      return { n: n(r?.n), distinct: n(r?.d) };
    },
    async attemptsOfSession(sessionRef) {
      const [r] = await db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM training_attempts a JOIN training_sessions s ON s.id = a."sessionId"
         WHERE s."referenceId" = ${sessionRef}`;
      return n(r?.n);
    },
    async bankCards(userId) {
      const [r] = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM training_cards WHERE "userId" = ${userId} AND deck = 'BANK'`;
      return n(r?.n);
    },
    async dueBankCards(userId, at) {
      const [r] = await db.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM training_cards
         WHERE "userId" = ${userId} AND deck = 'BANK' AND due <= ${at} AND ("suspendedUntil" IS NULL OR "suspendedUntil" <= ${at})`;
      return n(r?.n);
    },
    async day(userId, day) {
      const rows = await db.$queryRaw<{ b: number; p: number; d: number; plan: boolean }[]>`
        SELECT "bankReviewed" AS b, "puzzlesDone" AS p, "planDone" AS d, plan IS NOT NULL AS plan
          FROM training_days WHERE "userId" = ${userId} AND day = ${day}::date`;
      const r = rows[0];
      return r ? { bankReviewed: r.b, puzzlesDone: r.p, planDone: r.d, hasPlan: r.plan } : null;
    },
    async days(userId) {
      const rows = await db.$queryRaw<{ d: string }[]>`SELECT to_char(day, 'YYYY-MM-DD') AS d FROM training_days WHERE "userId" = ${userId} ORDER BY day`;
      return rows.map((r) => r.d);
    },
    async profile(userId) {
      const rows = await db.$queryRaw<{ s: number; d: string | null; r: number }[]>`
        SELECT "dayStreak" AS s, to_char("lastActiveDay", 'YYYY-MM-DD') AS d, "puzzleRating" AS r
          FROM training_profiles WHERE "userId" = ${userId}`;
      const r = rows[0];
      return r ? { dayStreak: r.s, lastActiveDay: r.d, puzzleRating: r.r } : null;
    },
    async firstBankCard(userId) {
      const rows = await db.$queryRaw<{ k: string; due: Date }[]>`
        SELECT "itemKey" AS k, due FROM training_cards WHERE "userId" = ${userId} AND deck = 'BANK' ORDER BY due, id LIMIT 1`;
      if (!rows[0]) throw new Error("the persona has no bank card");
      return { itemKey: rows[0].k, due: rows[0].due };
    },
  };
}

// ── Server time ─────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Moves the server clock (`ctx.now`, `requestNow()`) for every same-origin request of the page's context: documents,
 * RSC payloads and /api. Third-party requests (Clerk's Frontend API) are left alone, so no CORS preflight is added.
 * The browser clock is not moved (Clerk's client checks token times against it); the server renders the labels.
 */
export async function serverClock(page: Page, baseURL: string): Promise<{ set(at: Date): void; clear(): void }> {
  const origin = new URL(baseURL).origin;
  let at: Date | null = null;
  await page.context().route(
    (url) => url.origin === origin,
    async (route) => {
      if (!at) return route.fallback();
      await route.fallback({ headers: { ...route.request().headers(), ...serverNowHeaders(at) } });
    },
  );
  return {
    set(next) {
      at = next;
    },
    clear() {
      at = null;
    },
  };
}

// ── Runner ──────────────────────────────────────────────────────────────────────────────────────────────────────
export type Item = {
  itemId: string;
  kind: "bank" | "puzzle";
  pass: 1 | 2;
  cardRef: string | null;
  puzzleId: string | null;
  fen: string;
  setup: string[];
  solution: string[];
  accept: string[];
  orient: "w" | "b";
  rating?: number | null;
  theme: { key: string; label: string };
};
export type Payload = { sessionRef: string; kind: string; items: Item[]; [k: string]: unknown };

/** The board the member moves on (the pre-rendered next board carries `data-next`). */
export const RUNNER = '[data-testid="trainer-board"] > div:not([data-next])';

export function sessionRefOf(page: Page): string {
  const s = new URL(page.url()).searchParams.get("s");
  if (!s) throw new Error(`no ?s= on ${page.url()}`);
  return s;
}

/** Waits for the runner to put the session ref in the URL (create-or-resume) and returns it. */
export async function waitForSession(page: Page): Promise<string> {
  await expect(page).toHaveURL(/[?&]s=c[a-z0-9]+/, { timeout: 120_000 });
  return sessionRefOf(page);
}

/** GET /api/train/sessions/{ref} as the member (the payload carries the solutions: the viewer's own session). */
export async function sessionPayload(request: APIRequestContext, ref: string): Promise<Payload> {
  const res = await request.get(`/api/train/sessions/${ref}`);
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as { data: Payload | { payload: Payload } };
  const d = body.data as { payload?: Payload } & Payload;
  return d.payload ?? d;
}

export const itemsById = (p: Payload) => new Map(p.items.map((i) => [i.itemId, i]));

/** The item a pass-2 copy (`i3b`) repeats. */
export function itemOf(items: Map<string, Item>, id: string): Item {
  const it = items.get(id) ?? items.get(id.replace(/b$/, ""));
  if (!it) throw new Error(`item ${id} is not in the payload`);
  return it;
}

/** The runner's board on screen (its `data-item` names the current item). */
export const trainerBoard = (page: Page): Locator => page.locator('[data-testid="trainer-board"][data-item]').filter({ visible: true }).first();

/** Waits until the runner takes input on the current item; returns its id. */
export async function currentItem(page: Page): Promise<string> {
  const board = trainerBoard(page);
  await expect(board).toHaveAttribute("data-input", "", { timeout: 60_000 });
  return (await board.getAttribute("data-item"))!;
}

/** The next item after `prev` (or the first one). */
export async function nextItem(page: Page, prev: string | null): Promise<string> {
  if (prev) await expect.poll(async () => trainerBoard(page).getAttribute("data-item"), { timeout: 60_000 }).not.toBe(prev);
  return currentItem(page);
}

async function clickSquare(page: Page, scope: string, sq: string): Promise<void> {
  await page.locator(`${scope} [data-square="${sq}"]`).first().click();
}

export async function playUci(page: Page, uci: string): Promise<void> {
  await clickSquare(page, RUNNER, uci.slice(0, 2));
  await page.waitForTimeout(80);
  await clickSquare(page, RUNNER, uci.slice(2, 4));
  if (uci.length === 5) {
    await page.locator(`${RUNNER} [data-testid="promotion-picker"] [data-promotion="${uci[4]}"]`).first().click();
  }
}

/** Plays the member's moves of the line (solution[0], [2], …), waiting for each reply. */
export async function solveItem(page: Page, item: Item): Promise<void> {
  for (let i = 0; i < item.solution.length; i += 2) {
    await expect(trainerBoard(page)).toHaveAttribute("data-input", "", { timeout: 60_000 });
    await playUci(page, item.solution[i]!);
    await page.waitForTimeout(150);
  }
}

/** The position the member solves (after the setup move). */
export function solvePosition(item: Item): Chess {
  const c = new Chess(item.fen);
  for (const u of item.setup) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  return c;
}

/** A legal first move that is neither the solution nor an accepted alternative (never a promotion). */
export function wrongMove(item: Item): string {
  const ok = new Set([item.solution[0], ...item.accept]);
  const m = solvePosition(item)
    .moves({ verbose: true })
    .find((x) => !ok.has(`${x.from}${x.to}${x.promotion ?? ""}`) && !x.promotion);
  if (!m) throw new Error("no wrong move available");
  return `${m.from}${m.to}`;
}

/** Every SAN of the item's line (setup excluded), for `telemetry.forbid`. */
export function solutionSans(item: Item): string[] {
  const c = solvePosition(item);
  const out: string[] = [];
  for (const u of item.solution) {
    const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

/** Registers every solution SAN of the payload with the telemetry PII guard (plan §10.1). */
export function forbidSolutions(telemetry: Telemetry, items: Iterable<Item>): void {
  const seen = new Set<string>();
  for (const it of items) {
    for (const san of solutionSans(it)) {
      // One-letter-and-digit pawn moves ("e4") also occur inside other values by accident; the guard needs moves that
      // are unambiguous as SAN (a piece letter, a capture or a check).
      if (san.length < 3 || seen.has(san)) continue;
      seen.add(san);
      telemetry.forbid(san);
    }
  }
}

/** The visible grade bar. */
export const gradeBar = (page: Page): Locator => page.getByTestId("trainer-grades").filter({ visible: true }).first();

export async function grade(page: Page, which: "again" | "hard" | "good" | "easy"): Promise<void> {
  await expect(gradeBar(page)).toBeVisible({ timeout: 60_000 });
  await gradeBar(page).locator(`[data-grade="${which}"]`).click();
}

/** The suggested (primary) grade on the visible bar. */
export async function suggested(page: Page): Promise<string | null> {
  await expect(gradeBar(page)).toBeVisible({ timeout: 60_000 });
  return gradeBar(page).locator("[data-suggested]").first().getAttribute("data-grade");
}

/** The interval labels on the bar ("< 10 min", "2 days", …) by grade. */
export async function intervalLabels(page: Page): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const g of ["again", "hard", "good", "easy"]) {
    out[g] = ((await gradeBar(page).locator(`[data-grade="${g}"] .tr-grade__when`).textContent()) ?? "").trim();
  }
  return out;
}

export const control = (page: Page, id: string): Locator => page.locator(`[data-testid="${id}"]:visible, [data-testid="${id}-phone"]:visible`).first();

export async function hint(page: Page): Promise<void> {
  await control(page, "trainer-hint").click();
}

export async function showSolution(page: Page): Promise<void> {
  await control(page, "trainer-solution").click();
}

export const doneBlock = (page: Page): Locator => page.getByTestId("trainer-done").filter({ visible: true }).first();

/**
 * Solves every item first try and grades the suggested grade, until the session is done or `max` grades were given.
 * Returns the number of grades. `pick` may change the grade per item.
 */
export async function solveAndGradeAll(
  page: Page,
  items: Map<string, Item>,
  max: number,
  pick: (item: Item, suggestedGrade: string | null, index: number) => "again" | "hard" | "good" | "easy" = (_i, s) => (s ?? "good") as "good",
): Promise<number> {
  let id: string | null = null;
  let n = 0;
  const done = async () => (await page.getByTestId("trainer-done").filter({ visible: true }).count()) > 0;
  for (; n < max; n++) {
    if (id) {
      await expect
        .poll(
          async () =>
            (await done()) ||
            ((await trainerBoard(page).getAttribute("data-item")) !== id && (await trainerBoard(page).getAttribute("data-input")) === ""),
          { timeout: 60_000 },
        )
        .toBe(true);
    }
    if (await done()) break;
    id = await nextItem(page, id);
    const item = itemOf(items, id);
    await solveItem(page, item);
    await grade(page, pick(item, await suggested(page), n));
  }
  return n;
}

/** Opens the summary from the done block. */
export async function openSummary(page: Page): Promise<void> {
  await expect(doneBlock(page)).toBeVisible({ timeout: 60_000 });
  await page.locator('[data-testid="trainer-see-summary"]:visible').first().click();
  await page.waitForURL(/\/train\/session\/c[a-z0-9]+\/summary/, { timeout: 180_000 });
  await expect(page.getByTestId("session-summary")).toBeVisible({ timeout: 120_000 });
}

/** One viewport: the document scrolls neither way. */
export async function noDocumentScroll(page: Page, what = "page"): Promise<void> {
  const m = await page.evaluate(() => ({
    sh: document.scrollingElement!.scrollHeight,
    ih: window.innerHeight,
    sw: document.scrollingElement!.scrollWidth,
    iw: document.documentElement.clientWidth,
  }));
  expect(m.sh, `${what}: no vertical document scroll`).toBeLessThanOrEqual(m.ih + 1);
  expect(m.sw, `${what}: no horizontal document scroll`).toBeLessThanOrEqual(m.iw + 1);
}

/** The element is laid out fully inside the viewport. */
export async function inViewport(page: Page, locator: Locator, what: string): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${what} is laid out`).not.toBeNull();
  const vp = page.viewportSize()!;
  expect(box!.x, `${what} left`).toBeGreaterThanOrEqual(-1);
  expect(box!.y, `${what} top`).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, `${what} right`).toBeLessThanOrEqual(vp.width + 1);
  expect(box!.y + box!.height, `${what} bottom`).toBeLessThanOrEqual(vp.height + 1);
}

// ── Socket emits (home-backlog) ─────────────────────────────────────────────────────────────────────────────────
/**
 * One signed `/internal/emit` to the member's user room, as the web or the worker sends it (kid of the first key of
 * INTERNAL_API_SECRET, which the e2e socket server accepts for every event). Resolves with the HTTP status.
 */
export async function emitToUser(userRef: string, event: string, data: unknown): Promise<number> {
  const { internalFetch } = await import("../../../../lib/internal/fetch");
  const res = await internalFetch("/internal/emit", { body: { v: 1, targets: [{ userRef }], event, data, dedupeKey: `${event}:${randomUUID()}` } });
  return res.status;
}

// ── A bot game in the browser (game-over-bank-line) ─────────────────────────────────────────────────────────────
const LETTER: Record<string, string> = { pawn: "p", knight: "n", bishop: "b", rook: "r", queen: "q", king: "k" };
const VALUE: Record<string, number> = { p: 100, n: 300, b: 310, r: 500, q: 900, k: 0 };
const GAME = '[data-testid="game-board-container"]';

/** The position on the game board (piece images' alt "White Knight") with `turn` to move; no castling or ep rights. */
async function boardChess(page: Page, turn: "w" | "b"): Promise<Chess> {
  const pieces = await page.evaluate((scope) => {
    const root = document.querySelector(scope) ?? document;
    return [...root.querySelectorAll("[data-square]")].map((s) => ({
      sq: s.getAttribute("data-square")!,
      alt: s.querySelector('img[alt]:not([alt=""])')?.getAttribute("alt") ?? "",
    }));
  }, GAME);
  const grid: string[][] = Array.from({ length: 8 }, () => Array<string>(8).fill(""));
  for (const { sq, alt } of pieces) {
    const m = /^(White|Black)\s+(\w+)/i.exec(alt);
    const l = m ? LETTER[m[2]!.toLowerCase()] : undefined;
    if (!m || !l) continue;
    grid[8 - Number(sq[1])]![sq.charCodeAt(0) - 97] = m[1]!.toLowerCase() === "white" ? l.toUpperCase() : l;
  }
  const rows = grid.map((r) => {
    let s = "";
    let empty = 0;
    for (const c of r) {
      if (!c) empty++;
      else {
        if (empty) s += empty;
        empty = 0;
        s += c;
      }
    }
    return s + (empty ? empty : "");
  });
  return new Chess(`${rows.join("/")} ${turn} - - 0 1`);
}

/** The non-capturing move that hangs the most material to a 1-ply reply (what the fake engine grades a blunder). */
function blunderMove(chess: Chess): Move | null {
  let best: { m: Move; hung: number } | null = null;
  for (const m of chess.moves({ verbose: true })) {
    if (m.captured || m.promotion || m.piece === "k") continue;
    const c = new Chess(chess.fen());
    c.move(m);
    let hung = 0;
    for (const r of c.moves({ verbose: true })) if (r.captured) hung = Math.max(hung, VALUE[r.captured]!);
    if (!best || hung > best.hung) best = { m, hung };
  }
  return best && best.hung >= 300 ? best.m : null;
}

/** A quiet move that hangs nothing. */
function quietMove(chess: Chess): Move {
  const moves = chess.moves({ verbose: true }).filter((m) => !m.captured && !m.promotion && m.piece !== "k");
  for (const m of moves) {
    const c = new Chess(chess.fen());
    c.move(m);
    if (!c.moves({ verbose: true }).some((r) => r.captured && VALUE[r.captured]! >= 100)) return m;
  }
  return moves[0] ?? chess.moves({ verbose: true }).find((m) => !m.promotion) ?? chess.moves({ verbose: true })[0]!;
}

/**
 * Starts a bot game from /play and plays `own` moves: three quiet ones, then (when `blunders`) the move that hangs the
 * most material each turn; then resigns unless the bot mated first. Returns the game ref.
 */
export async function playBotGame(page: Page, opts: { own: number; blunders: boolean }): Promise<string> {
  await gotoOk(page, "/play");
  for (let attempt = 0; ; attempt++) {
    await page.getByTestId("start-game-button").click();
    // `next dev` can hold a first POST /api/games past the client's timeout while it compiles: press Start again.
    if (await page.waitForURL(/\/game\//, { timeout: 60_000 }).then(() => true, () => false)) break;
    if (attempt === 2) throw new Error("the bot game did not start");
    await gotoOk(page, "/play");
  }
  const ref = new URL(page.url()).pathname.split("/game/")[1]!;
  const box = page.locator(GAME);
  await expect(box).toHaveAttribute("data-phase", "bot", { timeout: 120_000 });
  const me = (await box.getAttribute("data-player-color")) as "w" | "b";
  for (let n = 0; n < opts.own; n++) {
    await expect
      .poll(async () => (await box.getAttribute("data-phase")) !== "bot" || (await box.getAttribute("data-current-turn")) === me, { timeout: 120_000 })
      .toBe(true);
    if ((await box.getAttribute("data-phase")) !== "bot") return ref;
    await page.waitForTimeout(300);
    const chess = await boardChess(page, me);
    const first = n < 3 || !opts.blunders ? quietMove(chess) : (blunderMove(chess) ?? quietMove(chess));
    const tried = new Set<string>();
    let moved = false;
    for (const m of [first, ...chess.moves({ verbose: true }).filter((x) => !x.promotion)]) {
      const key = `${m.from}${m.to}`;
      if (tried.has(key) || tried.size >= 4) continue;
      tried.add(key);
      await clickSquare(page, GAME, m.from);
      await page.waitForTimeout(150);
      await clickSquare(page, GAME, m.to);
      moved = await expect
        .poll(async () => (await box.getAttribute("data-phase")) !== "bot" || (await box.getAttribute("data-current-turn")) !== me, { timeout: 5_000 })
        .toBe(true)
        .then(() => true, () => false);
      if (moved) break;
      await page.keyboard.press("Escape").catch(() => undefined);
    }
    if (!moved) throw new Error(`no move registered at own move ${n}`);
  }
  await page.waitForTimeout(1_500);
  if ((await box.getAttribute("data-phase")) !== "bot") return ref;
  const menu = page.locator('[data-testid="game-menu-button"]:visible, [data-testid="game-menu-button-bar"]:visible').first();
  if (await menu.count()) await menu.click();
  await page.locator('[data-testid="resign-button"]:visible, [data-testid="resign-button-bar"]:visible').first().click();
  await page.locator('[data-testid="confirm-resign-button"]').click();
  return ref;
}

// ── Server telemetry ────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The member's W1 batches (`train_attempts_applied`, server, through the sink) applied exactly `ok` attempts, with no
 * conflict and no rejection. A batch the outbox re-sent after a lost response adds only `duplicates` (idempotent by
 * `clientAttemptId`), so `n` = ok + duplicates over all batches.
 */
export async function expectAttemptsApplied(telemetry: Telemetry, userRef: string, ok: number, opts: { conflicts?: number } = {}): Promise<void> {
  const sum = async () => {
    const batches = (await telemetry.events("server")).filter((e) => e.event === "train_attempts_applied" && e.distinctId === userRef);
    const total = (k: string) => batches.reduce((n, e) => n + Number(e.props[k] ?? 0), 0);
    return { n: total("n"), ok: total("ok"), duplicates: total("duplicates"), conflicts: total("conflicts"), rejected: total("rejected") };
  };
  await expect.poll(async () => (await sum()).ok, { timeout: 30_000, message: `train_attempts_applied ok sums to ${ok}` }).toBe(ok);
  const s = await sum();
  expect(s.conflicts, "no conflict").toBe(opts.conflicts ?? 0);
  expect(s.rejected, "no rejected attempt").toBe(0);
  expect(s.n, "every attempt sent was applied once or answered as a duplicate").toBe(s.ok + s.duplicates + s.conflicts);
}
