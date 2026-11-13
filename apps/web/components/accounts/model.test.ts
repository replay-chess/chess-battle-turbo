// The card model and the board state mapping (phase-04 plan §4.10, §8.11; DR/V4SettingsConnected*.dc.html): every one
// of the ten board states is reachable from data (the demo scenes are the fixtures the device suite opens).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONNECTED_BOARD_STATES } from "@repo/analytics";
import { LinkedAccountView } from "@repo/contracts/http/accounts";
import {
  accountRateLimitedFixture,
  accountSyncFailedFixture,
  accountSyncingFixture,
  accountWaitingFixture,
  linkedChessComFixture,
  linkedLichessFixture,
  runDoneFixture,
} from "@repo/contracts/http/fixtures/p04";
import { demoScene } from "./demo";
import {
  BOARD_STATES,
  SKIPPED_BANNER_MS,
  boardStateOf,
  cardModel,
  cardViewOf,
  isBoardState,
  panelModels,
  type CardModel,
  type LinkedCardModel,
} from "./model";

const NOW = Date.parse("2026-11-10T09:30:00.000Z");
const linked = (m: CardModel): LinkedCardModel => {
  assert.ok(m.linked, "expected a linked card");
  return m;
};
const cc = (a: LinkedAccountView | null, extra: { syncPending?: boolean; justLinked?: boolean } = {}) =>
  cardModel({ provider: a?.provider ?? "chesscom", account: a, nowMs: NOW, ...extra });

describe("cardModel", () => {
  it("unlinked: 'Not linked', pill Off", () => {
    const m = cc(null);
    assert.deepEqual(m, { linked: false, provider: "chesscom", title: "Not linked", pill: { label: "Off", tone: "neutral" } });
  });

  it("linked (default): initials, ratings, last sync line, good pill, sync offered", () => {
    const m = linked(cc({ ...linkedChessComFixture, run: { ...runDoneFixture, skipped: 0 } }));
    assert.equal(m.view, "linked");
    assert.equal(m.title, "KnightOwl_88");
    assert.equal(m.initials, "KN");
    assert.equal(m.ratings, "BLITZ 1032 · RAPID 1184");
    assert.equal(m.line, "Last sync 1 hour ago · 480 games imported");
    assert.deepEqual(m.pill, { label: "Linked", tone: "good" });
    assert.equal(m.banner, null);
    assert.equal(m.progress, null);
    assert.deepEqual([m.showSync, m.syncDisabled, m.syncLabel], [true, false, "Sync now"]);
    assert.equal(m.autoImportHint, "About 3 a.m. your time");
  });

  it("syncing: progress 'IMPORTING 212 / 480', warn pill, button disabled 'Syncing…'", () => {
    const m = linked(cc(accountSyncingFixture));
    assert.equal(m.view, "syncing");
    assert.equal(m.line, "Importing your latest games…");
    assert.deepEqual(m.progress, { label: "IMPORTING 212 / 480", value: 212, max: 480 });
    assert.deepEqual(m.pill, { label: "Syncing", tone: "warn" });
    assert.deepEqual([m.syncDisabled, m.syncLabel], [true, "Syncing…"]);
  });

  it("optimistic sync (AP-30) and a queued run read as syncing before any progress", () => {
    const base = { ...linkedChessComFixture, run: { ...runDoneFixture, skipped: 0 } };
    assert.equal(linked(cc(base, { syncPending: true })).view, "syncing");
    const queued = linked(cc({ ...base, status: "queued", run: { ...runDoneFixture, status: "queued", imported: 0, total: null, finishedAt: null } }));
    assert.equal(queued.view, "syncing");
    assert.deepEqual(queued.progress, { label: "IMPORTING 0 / …", value: 0, max: 0 });
  });

  it("sync failed: bad pill, the plan's banner, Try again = Sync now", () => {
    const m = linked(cc(accountSyncFailedFixture));
    assert.equal(m.view, "sync_failed");
    assert.deepEqual(m.pill, { label: "Sync failed", tone: "bad" });
    assert.equal(m.line, "Last sync failed 5 minutes ago");
    assert.deepEqual(m.banner, {
      kind: "sync_failed",
      text: "Chess.com didn’t respond. Your 480 imported games are safe; the last good sync was 2 hours ago.",
    });
    assert.equal(m.showSync, true);
  });

  it("rate limited: Paused + countdown while nextAllowedSyncAt is ahead, then a normal card", () => {
    const m = linked(cc(accountRateLimitedFixture));
    assert.equal(m.view, "rate_limited");
    assert.deepEqual(m.pill, { label: "Paused", tone: "warn" });
    assert.deepEqual(m.banner, { kind: "rate_limited", secondsLeft: 30 });
    assert.equal(m.syncDisabled, true);
    const later = cardModel({ provider: "lichess", account: accountRateLimitedFixture, nowMs: NOW + 31_000 });
    assert.equal(linked(later).view, "linked");
    assert.equal(linked(later).syncDisabled, false);
  });

  it("skipped games: the private_games banner for a day after the run, then gone", () => {
    const fresh = { ...linkedChessComFixture, run: { ...runDoneFixture, finishedAt: new Date(NOW - 60_000).toISOString() } };
    const m = linked(cc(fresh));
    assert.equal(m.view, "private_games");
    assert.deepEqual(m.pill, { label: "Linked", tone: "warn" });
    assert.deepEqual(m.banner, { kind: "private_games", text: "We imported 474 of 480 games. 6 were skipped: variants, unrated or unfinished games." });
    const old = { ...fresh, run: { ...fresh.run, finishedAt: new Date(NOW - SKIPPED_BANNER_MS - 1).toISOString() } };
    assert.equal(linked(cc(old)).view, "linked");
  });

  it("waiting for the trial: info banner, no Sync now, Disconnect stays", () => {
    const m = linked(cc(accountWaitingFixture));
    assert.equal(m.view, "waiting");
    assert.deepEqual(m.banner, { kind: "waiting", text: "Importing starts when your trial begins." });
    assert.equal(m.showSync, false);
    assert.equal(m.line, "Not synced yet");
  });

  it("closed and vanished accounts: bad banner, no Sync now", () => {
    const closed = linked(cc({ ...accountSyncFailedFixture, lastError: { code: "closed", at: accountSyncFailedFixture.lastError!.at, retryAt: null } }));
    assert.equal(closed.view, "closed");
    assert.equal(closed.showSync, false);
    assert.match((closed.banner as { text: string }).text, /was closed/);
    const gone = linked(cc({ ...accountSyncFailedFixture, lastError: { code: "not_found", at: accountSyncFailedFixture.lastError!.at, retryAt: null } }));
    assert.equal(gone.view, "gone");
    assert.equal(gone.showSync, false);
  });

  it("Lichess just linked: 'Linked just now'", () => {
    const m = linked(cardModel({ provider: "lichess", account: { ...linkedLichessFixture }, nowMs: NOW, justLinked: true }));
    assert.equal(m.line, "Linked just now · 96 games imported");
    assert.equal(m.ratings, "BLITZ 1402 · RAPID 1350");
  });

  it("cardViewOf covers every view status", () => {
    const base = { ...linkedChessComFixture, run: { ...runDoneFixture, skipped: 0 } };
    const views = (["linked", "waiting_for_membership", "queued", "syncing", "rate_limited", "error"] as const).map((status) =>
      cardViewOf({ ...base, status, nextAllowedSyncAt: new Date(NOW + 5000).toISOString() }, NOW),
    );
    assert.deepEqual(views, ["linked", "waiting", "syncing", "syncing", "rate_limited", "sync_failed"]);
  });
});

describe("board states", () => {
  it("the enum is the board's ten states", () => {
    assert.equal(BOARD_STATES.length, 10);
    // The analytics registry repeats the enum for `settings_connected_viewed.state` (no drift).
    assert.deepEqual([...BOARD_STATES], [...CONNECTED_BOARD_STATES]);
    assert.ok(isBoardState("li_denied"));
    assert.ok(!isBoardState("looking"));
  });

  it("every board state is reachable from data (the /dev/ui/connected scenes), normal and stress", () => {
    for (const stress of [false, true]) {
      for (const state of BOARD_STATES) {
        const s = demoScene(state, NOW, stress);
        for (const a of [s.chesscom, s.lichess]) if (a) LinkedAccountView.parse(a);
        const { state: got } = panelModels({
          nowMs: NOW,
          chesscom: s.chesscom,
          lichess: s.lichess,
          syncPending: { chesscom: false, lichess: false },
          cc: { error: s.ccError },
          li: { connecting: s.liConnecting, returned: s.liReturned, justLinked: false },
        });
        assert.equal(got, state, `${state} stress=${stress}`);
      }
    }
  });

  it("priorities: Lichess return first, then not_found, none_linked, then the account views", () => {
    const off = cc(null);
    const ok = cc({ ...linkedChessComFixture, run: { ...runDoneFixture, skipped: 0 } });
    const none = { ccNotFound: false, liConnecting: false, liDenied: false };
    assert.equal(boardStateOf(off, off, none), "none_linked");
    assert.equal(boardStateOf(off, off, { ...none, ccNotFound: true }), "not_found");
    assert.equal(boardStateOf(ok, off, { ...none, liDenied: true }), "li_denied");
    assert.equal(boardStateOf(ok, off, { ...none, liConnecting: true, liDenied: true }), "li_connecting");
    assert.equal(boardStateOf(ok, off, none), "default");
    const li = cardModel({ provider: "lichess", account: linkedLichessFixture, nowMs: NOW });
    assert.equal(boardStateOf(ok, li, none), "both_linked");
    assert.equal(boardStateOf(cc(accountSyncFailedFixture), li, none), "sync_failed");
    assert.equal(boardStateOf(off, cardModel({ provider: "lichess", account: accountRateLimitedFixture, nowMs: NOW }), none), "rate_limited");
  });
});
