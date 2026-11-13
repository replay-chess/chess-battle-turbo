// /dev/ui/connected fixtures (phase-04 plan §4.12): the board's data (knightowl_88 on Chess.com, knightowl88 on
// Lichess) from the contract fixtures, re-timed against the demo's clock so "Last sync 2 hours ago" reads right, plus
// the stress variant (TST X9: 20-character usernames, five-digit counts). Pure, no network.
import type { LinkedAccountView, RunView } from "@repo/contracts/http/accounts";
import {
  accountRateLimitedFixture,
  accountSyncFailedFixture,
  accountSyncingFixture,
  linkedChessComFixture,
  linkedLichessFixture,
  runDoneFixture,
} from "@repo/contracts/http/fixtures/p04";
import type { ChessComFormError } from "./ChessComLinkForm";
import type { LichessReturn } from "./LichessConnect";
import type { BoardState } from "./model";

export const DEMO_CHESSCOM_USERNAME = "knightowl_88";
export const STRESS_CHESSCOM_USERNAME = "averyverylongname_20";
export const STRESS_LICHESS_USERNAME = "anotherlongerhandle1";

const MIN = 60_000;
const ago = (now: number, minutes: number) => new Date(now - minutes * MIN).toISOString();
const ahead = (now: number, seconds: number) => new Date(now + seconds * 1000).toISOString();

export type DemoScene = {
  chesscom: LinkedAccountView | null;
  lichess: LinkedAccountView | null;
  ccInput: string;
  ccError: ChessComFormError;
  liConnecting: boolean;
  liReturned: LichessReturn;
};

/** A finished run with nothing skipped (the board's `default` has no banner). */
function cleanRun(now: number, base: RunView, imported: number): RunView {
  return { ...base, status: "done", phase: "saving", seen: imported, total: imported, imported, skipped: 0, finishedAt: ago(now, 120), updatedAt: ago(now, 120) };
}

export function demoChessCom(now: number, stress: boolean): LinkedAccountView {
  const imported = stress ? 12_480 : 480;
  return {
    ...linkedChessComFixture,
    username: stress ? STRESS_CHESSCOM_USERNAME : DEMO_CHESSCOM_USERNAME,
    ratings: stress
      ? { bullet: { rating: 2140, best: 2201, games: 9_120 }, blitz: { rating: 1987, best: 2050, games: 3_310 }, rapid: { rating: 1890, best: 1902, games: 50 } }
      : { blitz: { rating: 1179, best: 1210, games: 300 }, rapid: { rating: 1206, best: 1243, games: 180 } },
    importedCount: imported,
    skippedCount: 0,
    lastSyncAt: ago(now, 120),
    lastSyncOkAt: ago(now, 120),
    nextAutoSyncAt: ahead(now, 16 * 3600),
    run: cleanRun(now, runDoneFixture, imported),
  };
}

export function demoLichess(now: number, stress: boolean): LinkedAccountView {
  const imported = stress ? 10_096 : 96;
  return {
    ...linkedLichessFixture,
    username: stress ? STRESS_LICHESS_USERNAME : linkedLichessFixture.username,
    ratings: { blitz: { rating: 1402, best: null, games: imported } },
    importedCount: imported,
    lastSyncAt: ago(now, 0.2),
    lastSyncOkAt: ago(now, 0.2),
    run: { ...cleanRun(now, linkedLichessFixture.run!, imported), finishedAt: ago(now, 0.2) },
  };
}

/** The Chess.com card syncing at `imported` of `total` (the board's 212 / 480 start). */
export function demoSyncing(base: LinkedAccountView, now: number, imported: number, total: number): LinkedAccountView {
  return {
    ...base,
    status: "syncing",
    run: { ...accountSyncingFixture.run!, provider: base.provider, trigger: "manual", seen: total, total, imported, startedAt: ago(now, 1), updatedAt: new Date(now).toISOString() },
  };
}

export function demoScene(state: BoardState, now: number, stress: boolean): DemoScene {
  const cc = demoChessCom(now, stress);
  const li = demoLichess(now, stress);
  const scene: DemoScene = { chesscom: cc, lichess: null, ccInput: "", ccError: null, liConnecting: false, liReturned: null };
  switch (state) {
    case "default":
      return scene;
    case "syncing":
      return { ...scene, chesscom: demoSyncing(cc, now, 212, stress ? 12_480 : 480) };
    case "sync_failed":
      return {
        ...scene,
        chesscom: {
          ...cc,
          status: accountSyncFailedFixture.status,
          lastSyncAt: ago(now, 1),
          lastError: { code: "upstream", at: ago(now, 1), retryAt: null },
          run: { ...accountSyncFailedFixture.run!, error: { code: "upstream", at: ago(now, 1), retryAt: null }, finishedAt: ago(now, 1) },
        },
      };
    case "rate_limited":
      return {
        ...scene,
        chesscom: {
          ...cc,
          status: accountRateLimitedFixture.status,
          nextAllowedSyncAt: ahead(now, 30),
          lastError: { code: "rate_limited", at: new Date(now).toISOString(), retryAt: ahead(now, 30) },
        },
      };
    case "not_found": {
      const typed = stress ? "averyverylongname_2x" : "knightowl_8";
      return { ...scene, chesscom: null, ccInput: typed, ccError: { kind: "not_found", typed } };
    }
    case "private_games": {
      const seen = stress ? 12_480 : 480;
      const skipped = stress ? 2_168 : 168;
      return {
        ...scene,
        chesscom: {
          ...cc,
          importedCount: seen - skipped,
          skippedCount: skipped,
          run: { ...cc.run!, seen, total: seen, imported: seen - skipped, skipped, finishedAt: ago(now, 1) },
        },
      };
    }
    case "li_connecting":
      return { ...scene, liConnecting: true };
    case "li_denied":
      return { ...scene, liReturned: { kind: "denied" } };
    case "both_linked":
      return { ...scene, lichess: li };
    case "none_linked":
      return { ...scene, chesscom: null, ccInput: "" };
  }
}
