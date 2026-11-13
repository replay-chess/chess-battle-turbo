// Connected accounts: what each card shows (phase-04 plan §4.10, §8.11; DR/V4SettingsConnected*.dc.html). Pure and
// zod-free (type-only contract imports), so the real page, the /dev/ui/connected demo and the unit tests share one
// mapping from `LinkedAccountView` (+ the page's local state) to the card and to the board's ten states.
import type { LinkedAccountView } from "@repo/contracts/http/accounts";
import type { ProviderSlug } from "@repo/contracts/http/p04-plain";
import { accountInitials } from "@/lib/accounts/avatars";
import {
  AUTO_IMPORT_HINT,
  WAITING_FOR_TRIAL,
  closedCopy,
  gamesImported,
  goneCopy,
  importingLabel,
  ratingsLine,
  relativeTime,
  skippedCopy,
  syncFailedCopy,
} from "./copy";

/** The board enum of V4SettingsConnected / V4SettingsConnectedError (`looking` is the local in-flight state). */
export const BOARD_STATES = [
  "default",
  "syncing",
  "sync_failed",
  "rate_limited",
  "not_found",
  "private_games",
  "li_connecting",
  "li_denied",
  "both_linked",
  "none_linked",
] as const;
export type BoardState = (typeof BOARD_STATES)[number];

export function isBoardState(s: string | undefined | null): s is BoardState {
  return (BOARD_STATES as readonly string[]).includes(s ?? "");
}

/** How long "SAVED · SYNCED" stays after a settings write (the board's 2.6 s). */
export const SAVED_FLASH_MS = 2_600;

/** A finished run's skipped games are reported for this long (then the banner goes away until the next run). */
export const SKIPPED_BANNER_MS = 24 * 60 * 60_000;

export type PillTone = "neutral" | "good" | "warn" | "bad";
export type Pill = { label: string; tone: PillTone };

/** How one linked card reads. `private_games` = the run skipped games (inv-acct Q19). */
export type CardView = "linked" | "syncing" | "sync_failed" | "rate_limited" | "private_games" | "closed" | "gone" | "waiting";

export type CardBanner =
  | { kind: "sync_failed"; text: string }
  | { kind: "rate_limited"; secondsLeft: number }
  | { kind: "private_games"; text: string }
  | { kind: "closed"; text: string }
  | { kind: "gone"; text: string }
  | { kind: "waiting"; text: string };

export type LinkedCardModel = {
  linked: true;
  provider: ProviderSlug;
  view: CardView;
  title: string;
  initials: string;
  ratings: string | null;
  line: string;
  pill: Pill;
  /** `IMPORTING n / N` + the bar, while a sync runs. */
  progress: { label: string; value: number; max: number } | null;
  banner: CardBanner | null;
  /** Sync now is offered (not while waiting for the trial, not for a closed or vanished account). */
  showSync: boolean;
  syncDisabled: boolean;
  syncLabel: "Sync now" | "Syncing…";
  autoImport: boolean;
  autoImportHint: string;
  /** For "Also delete the N imported games". */
  importedCount: number;
};

export type UnlinkedCardModel = { linked: false; provider: ProviderSlug; title: "Not linked"; pill: Pill };

export type CardModel = LinkedCardModel | UnlinkedCardModel;

export type CardInput = {
  provider: ProviderSlug;
  account: LinkedAccountView | null;
  nowMs: number;
  /** A sync POST is in flight (the optimistic `syncing` row, api-perf AP-30). */
  syncPending?: boolean;
  /** Lichess just came back from OAuth (`?lichess=linked`): "Linked just now". */
  justLinked?: boolean;
};

const PILL: Record<CardView, Pill> = {
  linked: { label: "Linked", tone: "good" },
  syncing: { label: "Syncing", tone: "warn" },
  sync_failed: { label: "Sync failed", tone: "bad" },
  rate_limited: { label: "Paused", tone: "warn" },
  private_games: { label: "Linked", tone: "warn" },
  closed: { label: "Closed", tone: "bad" },
  gone: { label: "Sync failed", tone: "bad" },
  waiting: { label: "Waiting", tone: "warn" },
};

const OFF: Pill = { label: "Off", tone: "neutral" };

function secondsUntil(iso: string | null, nowMs: number): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : Math.max(0, (t - nowMs) / 1000);
}

/** The card's view from the account's view status, its newest run and its last error (§8.11). */
export function cardViewOf(a: LinkedAccountView, nowMs: number, syncPending = false): CardView {
  if (a.status === "waiting_for_membership") return "waiting";
  if (a.status === "error") {
    if (a.lastError?.code === "closed") return "closed";
    if (a.lastError?.code === "not_found") return "gone";
    return "sync_failed";
  }
  // A provider pause keeps its countdown even while the paused run waits as `queued` (§8.11 429 row).
  if (a.status === "rate_limited" && secondsUntil(a.nextAllowedSyncAt, nowMs) > 0) return "rate_limited";
  if (syncPending || a.status === "syncing" || a.status === "queued") return "syncing";
  if (a.run?.status === "running" || a.run?.status === "queued") return "syncing";
  const run = a.run;
  if (
    run &&
    run.status === "done" &&
    run.skipped > 0 &&
    run.finishedAt !== null &&
    nowMs - Date.parse(run.finishedAt) < SKIPPED_BANNER_MS
  ) {
    return "private_games";
  }
  return "linked";
}

function lineOf(a: LinkedAccountView, view: CardView, nowMs: number, justLinked: boolean): string {
  if (view === "syncing") return "Importing your latest games…";
  if (view === "sync_failed") {
    const at = a.lastError?.at ?? a.lastSyncAt;
    return at ? `Last sync failed ${relativeTime(at, nowMs)}` : "Last sync failed";
  }
  if (justLinked) return `Linked just now · ${gamesImported(a.importedCount)}`;
  if (view === "waiting") return "Not synced yet";
  if (!a.lastSyncOkAt) return a.importedCount > 0 ? `Not synced yet · ${gamesImported(a.importedCount)}` : "Not synced yet";
  return `Last sync ${relativeTime(a.lastSyncOkAt, nowMs)} · ${gamesImported(a.importedCount)}`;
}

function bannerOf(a: LinkedAccountView, view: CardView, nowMs: number): CardBanner | null {
  switch (view) {
    case "sync_failed":
      return { kind: "sync_failed", text: syncFailedCopy(a.provider, a.importedCount, a.lastSyncOkAt, nowMs) };
    case "rate_limited":
      return { kind: "rate_limited", secondsLeft: secondsUntil(a.nextAllowedSyncAt, nowMs) };
    case "private_games": {
      const run = a.run!;
      return { kind: "private_games", text: skippedCopy(run.imported, run.seen, run.skipped) };
    }
    case "closed":
      return { kind: "closed", text: closedCopy(a.provider, a.importedCount) };
    case "gone":
      return { kind: "gone", text: goneCopy(a.provider, a.username) };
    case "waiting":
      return { kind: "waiting", text: WAITING_FOR_TRIAL };
    default:
      return null;
  }
}

export function cardModel(input: CardInput): CardModel {
  const { provider, account: a, nowMs } = input;
  if (!a) return { linked: false, provider, title: "Not linked", pill: OFF };
  const view = cardViewOf(a, nowMs, input.syncPending);
  const run = a.run;
  const syncing = view === "syncing";
  const progressRun = syncing && run && (run.status === "running" || run.status === "queued") ? run : null;
  return {
    linked: true,
    provider,
    view,
    title: a.username,
    initials: accountInitials(a.username),
    ratings: ratingsLine(a.ratings),
    line: lineOf(a, view, nowMs, Boolean(input.justLinked) && view === "linked"),
    pill: PILL[view],
    progress: progressRun
      ? { label: importingLabel(progressRun.imported, progressRun.total), value: progressRun.imported, max: progressRun.total ?? 0 }
      : syncing
        ? { label: importingLabel(0, null), value: 0, max: 0 }
        : null,
    banner: bannerOf(a, view, nowMs),
    showSync: view !== "waiting" && view !== "closed" && view !== "gone",
    syncDisabled: syncing || view === "rate_limited",
    syncLabel: syncing ? "Syncing…" : "Sync now",
    autoImport: a.autoImport,
    autoImportHint: AUTO_IMPORT_HINT,
    importedCount: a.importedCount,
  };
}

/** The page's local state that the board enum also covers. */
export type LocalState = {
  /** The Chess.com link POST answered 404 (`not_found`). */
  ccNotFound: boolean;
  /** "Connect Lichess" was clicked and the page is navigating away. */
  liConnecting: boolean;
  /** The OAuth return said `?lichess=denied`. */
  liDenied: boolean;
};

const VIEW_PRIORITY: readonly [CardView, BoardState][] = [
  ["syncing", "syncing"],
  ["sync_failed", "sync_failed"],
  ["gone", "sync_failed"],
  ["closed", "sync_failed"],
  ["rate_limited", "rate_limited"],
  ["private_games", "private_games"],
];

/** The one board state a page is in (telemetry `settings_connected_viewed`, `data-state`). */
export function boardStateOf(chesscom: CardModel, lichess: CardModel, local: LocalState): BoardState {
  if (local.liConnecting) return "li_connecting";
  if (local.liDenied) return "li_denied";
  if (local.ccNotFound && !chesscom.linked) return "not_found";
  if (!chesscom.linked && !lichess.linked) return "none_linked";
  const views = [chesscom, lichess].flatMap((c) => (c.linked ? [c.view] : []));
  for (const [view, state] of VIEW_PRIORITY) if (views.includes(view)) return state;
  return chesscom.linked && lichess.linked ? "both_linked" : "default";
}

/** What the panel needs to know about its local state (a subset of ConnectedPanelProps). */
export type PanelInput = {
  nowMs: number;
  chesscom: LinkedAccountView | null;
  lichess: LinkedAccountView | null;
  syncPending: Record<ProviderSlug, boolean>;
  cc: { error: { kind: string } | null };
  li: { connecting: boolean; returned: { kind: string } | null; justLinked: boolean };
};

/** The two card models and the board state, for the panel, the screen's telemetry and the demo's clock. */
export function panelModels(p: PanelInput): { chesscom: CardModel; lichess: CardModel; state: BoardState } {
  const chesscom = cardModel({ provider: "chesscom", account: p.chesscom, nowMs: p.nowMs, syncPending: p.syncPending.chesscom });
  const lichess = cardModel({
    provider: "lichess",
    account: p.lichess,
    nowMs: p.nowMs,
    syncPending: p.syncPending.lichess,
    justLinked: p.li.justLinked,
  });
  const state = boardStateOf(chesscom, lichess, {
    ccNotFound: p.cc.error?.kind === "not_found",
    liConnecting: p.li.connecting,
    liDenied: p.li.returned?.kind === "denied",
  });
  return { chesscom, lichess, state };
}

/** True while a card's sync still moves on its own (the toast watcher and the demo's ticker read it). */
export function isSyncingView(c: CardModel): boolean {
  return c.linked && c.view === "syncing";
}
