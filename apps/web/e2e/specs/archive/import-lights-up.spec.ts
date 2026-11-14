// The archive lights up with an import (phase-04 plan §12.4 `archive/import-lights-up.spec.ts`; §4.11, §5.6). @p4
//
// 1. Persona `import-trial` (in the trial, Chess.com importing 212 / 480): /games shows the `import_running` banner
//    "IMPORTING 212 / 480 · Chess.com" and the source tabs with their counts.
// 2. A live import: persona `connected-none-member` links a fixture account in settings while the mock answers each
//    month slowly; /games shows the banner with the run's own numbers, the Chess.com tab grows as chunks land
//    (`games:changed` refetches the first page), then the banner goes away; the legacy profile API (P0's
//    /api/profile/[ref]) lists none of the imported games (its `source: REPLAY` filter, plan §3).
// Project: desktop-1440. @local-only (the mock and the worker).
import {
  DEVICES,
  FIXTURE_IMPORTABLE,
  FIXTURE_TOTAL,
  clickReady,
  expect,
  gotoOk,
  test,
  tid,
  uniqueHandle,
  waitHydrated,
} from "../onboarding/_lib/p04";

test.describe.configure({ mode: "serial" });
test.use(DEVICES["desktop-1440"]);

const tabCount = async (page: import("@playwright/test").Page, id: string) =>
  Number(((await tid(page, `games-source-${id}`).textContent()) ?? "").replace(/[^\d]/g, "") || "0");

test(
  "a running import: the banner and the source tabs (seeded)",
  // One state of the archive's three boards (the convention of review/games-archive.spec.ts ARCHIVE_BOARDS): tagging only
  // V3GamesArchive left V3GamesArchiveEmpty/Filters.import_running missing in `state-coverage --phase 5` (REGRESSION-5).
  { tag: ["@p4", "@local-only", "@smoke", ...["V3GamesArchive", "V3GamesArchiveEmpty", "V3GamesArchiveFilters"].map((b) => `@state:${b}.import_running`)] },
  async ({ page, leasePersona }, testInfo) => {
    test.skip(testInfo.project.name === "webkit-iphone", "desktop only");
    test.setTimeout(120_000);
    await leasePersona("import-trial");
    await gotoOk(page, "/games");
    const banner = tid(page, "games-import-banner");
    await expect(banner).toBeVisible({ timeout: 60_000 });
    await expect(banner).toContainText("IMPORTING 212 / 480");
    await expect(banner).toContainText("Chess.com");
    await expect(tid(page, "games-source-tabs")).toBeVisible();
    await expect(tid(page, "games-source-chesscom")).toBeVisible();
    expect(await tabCount(page, "chesscom")).toBeGreaterThan(0);
  },
);

test(
  "a live import grows the list, the banner goes away, the legacy profile stays clean",
  { tag: ["@p4", "@local-only"] },
  async ({ page, leasePersona, upstream }, testInfo) => {
    test.skip(testInfo.project.name === "webkit-iphone", "desktop only");
    test.setTimeout(300_000);
    const me = await leasePersona("connected-none-member");
    const handle = uniqueHandle("lights", testInfo);
    // Each month of this handle answers after 4 s: the import stays visible for a while.
    await upstream.delay("chesscom", 4_000, `/pub/player/${handle.toLowerCase()}/games/\\d{4}/`);

    // The pool user may hold Replay Chess games of its own (other specs played on it): the list's last index counts
    // them too (FIX-1: the poll expected exactly the imported games and saw one more).
    const before = await page.request.get("/api/me/games?limit=0");
    expect(before.status()).toBe(200);
    const own = Number(((await before.json()) as { meta?: { counts?: { all?: number } } }).meta?.counts?.all ?? 0);
    const legacyBefore = await page.request.get(`/api/profile/${me.ref}`);
    expect(legacyBefore.status()).toBe(200);
    const legacyOwn = ((await legacyBefore.json()) as { data: { games: unknown[] } }).data.games.length;

    await gotoOk(page, "/settings/connected");
    await waitHydrated(page, '[data-testid="account-chesscom-lookup"]');
    await tid(page, "account-chesscom-input").fill(handle);
    // The link's response, not only the card: leaving at once aborted the POST mid-flight, so /games rendered before
    // the link had committed (no Chess.com account in the viewer, no tab) and its events could land before the socket
    // was up (FIX-1 finding 4; the after-effects themselves no longer depend on the connection, lib/api/context.ts).
    const linked = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/accounts/chesscom", { timeout: 60_000 });
    await clickReady(page, "account-chesscom-lookup");
    expect((await linked).status()).toBe(201);
    await expect(tid(page, "account-card-chesscom")).toBeVisible({ timeout: 60_000 });

    await gotoOk(page, "/games");
    const banner = tid(page, "games-import-banner");
    await expect(banner).toBeVisible({ timeout: 60_000 });
    // "IMPORTING 0 / …" while the run reads (the total is not known yet), then the run's numbers.
    await expect(banner).toContainText(/IMPORTING \d+ \/ (\d+|…)/);
    // The list grows while the run saves chunk by chunk, without a reload (`games:changed` refetches the list). The
    // list is virtualised, so its size is the scroll height (every row's slot), not the DOM rows: a height seen while
    // importing must be below the final one (regression: archive-virtual-rows; the DOM count capped at 23).
    const rows = page.locator('[data-testid="games-row"]');
    const list = tid(page, "games-list");
    const heightOf = () => list.evaluate((el) => el.scrollHeight).catch(() => 0);
    const during: number[] = [];
    await expect
      .poll(
        async () => {
          during.push(await heightOf());
          return banner.isVisible();
        },
        { timeout: 180_000, intervals: [1_000] },
      )
      .toBe(false);
    // After the run, without a reload: every imported game is in the list. The list is virtualised (only the rows
    // near the viewport are in the DOM, overscan 8), so the DOM row count says nothing about the data: scroll to the
    // end (the next page loads through the sentinel) until the last row, index FIXTURE_IMPORTABLE − 1, renders and
    // nothing past it does (regression: archive-virtual-rows; this asserted 30 DOM rows and failed on 23).
    await expect
      .poll(
        async () => {
          await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
          return rows.evaluateAll((els) => Math.max(-1, ...els.map((e) => Number(e.getAttribute("data-index")))));
        },
        { timeout: 30_000 },
      )
      .toBe(own + FIXTURE_IMPORTABLE - 1);
    const final = await heightOf();
    // Heights of 0 are the moments before the first chunk (no list yet); the first list on screen was partial.
    const partial = during.filter((h) => h > 0);
    expect(partial.length, "the list showed while importing").toBeGreaterThan(0);
    expect(Math.min(...partial), `the list grew while importing (heights ${during.join(" → ")} → ${final})`).toBeLessThan(final);
    expect(FIXTURE_TOTAL - FIXTURE_IMPORTABLE).toBe(3);

    // The legacy profile API: the imported games are COMPLETED with this member as creator, but are not "played".
    const res = await page.request.get(`/api/profile/${me.ref}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { data: { games: unknown[] } };
    expect(body.data.games, "the pool user's own Replay games only, none of the imported ones").toHaveLength(legacyOwn);

    // The source tabs on the open page (no reload) count the import.
    await expect(tid(page, "games-source-tabs")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => tabCount(page, "chesscom"), { timeout: 30_000 }).toBe(FIXTURE_IMPORTABLE);
  },
);
