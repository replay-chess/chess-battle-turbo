// The import progress card's state mapping (phase-04 plan §4.7, §4.8; D4-07; V3OnbActivating, V3OnbDone). Pure and
// client-safe: components/import/ImportProgressCard.tsx renders the view, the demo routes and import-card.test.ts
// build it from fixtures.
//
// The card shows the newest run (`currentRun()`): waiting for the trial (D4-07: a link made before the trial waits
// as WAITING_FOR_MEMBERSHIP), queued, reading ("{seen} found", indeterminate bar), saving ("{imported} / {total}",
// determinate bar, an ETA on Done), done (the first review's moments), done with nothing to import, or failed
// ("Import stopped at …" + Retry Import). No linked account: a pointer to Settings · Connected accounts.
import type { FirstReview } from "@repo/contracts/http/import";
import type { RunView } from "@repo/contracts/http/accounts";

export type ImportCardContext = "activating" | "done";
export type ProviderSlug = "chesscom" | "lichess";

export type ImportCardInput = {
  context: ImportCardContext;
  run: RunView | null;
  firstReview: FirstReview | null;
  /** Providers with an ACTIVE link. */
  linked: readonly ProviderSlug[];
  /** The membership is live (or the paywall is off): a linked account without a run is about to be queued. */
  entitled: boolean;
  /** The pending checkout is a trial ("Waiting for your trial to start") or a paid start. */
  trial: boolean;
  /** Seconds left from the progress rate (useImportProgress), or null. */
  etaSec: number | null;
};

export type ImportCardState = "none" | "waiting" | "queued" | "reading" | "saving" | "imported" | "empty" | "failed";

/** The Done board's enum for the state-coverage tags (`importing`, `imported`, `import_failed`). */
export type ImportBoardState = "importing" | "imported" | "import_failed";

export type ImportBar = { kind: "indeterminate"; text: string } | { kind: "determinate"; value: number; max: number };

export type ImportCardView = {
  state: ImportCardState;
  boardState: ImportBoardState | null;
  /** The overline ("Importing games") or, when failed, the bad headline. */
  label: string;
  /** Right-aligned mono count ("212 / 480", "480 games"). */
  count: string | null;
  tone: "neutral" | "bad";
  bar: ImportBar | null;
  hint: string;
  /** Show "Retry Import" (a failed run the member may retry). */
  retry: boolean;
  /** The hint ends with a link to Settings · Connected accounts. */
  settingsLink: boolean;
};

export const SETTINGS_CONNECTED_PATH = "/settings/connected";
export const SETTINGS_LINK_TEXT = "Settings · Connected accounts";

export function providerName(p: ProviderSlug): string {
  return p === "chesscom" ? "Chess.com" : "Lichess";
}

/** "12,480": grouped digits (the five-digit stress counts). */
export function formatCount(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString("en-US");
}

function games(n: number): string {
  return `${formatCount(n)} ${n === 1 ? "game" : "games"}`;
}

/**
 * "About 2 minutes" (≥ 90 s), "About a minute" (60–89 s), "Less than a minute" (< 60 s), or null when unknown
 * (§4.8: `eta = ceil((total − imported) / rate)`).
 */
export function etaLabel(sec: number | null): string | null {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return null;
  if (sec < 60) return "Less than a minute";
  if (sec < 90) return "About a minute";
  return `About ${Math.round(sec / 60)} minutes`;
}

const ACTIVATING_TAIL = "Runs in the background either way.";
const DONE_TAIL = "We'll show your first review on Home.";

function tail(context: ImportCardContext): string {
  return context === "activating" ? ACTIVATING_TAIL : DONE_TAIL;
}

/** The first review's line on a finished import (§4.8 `imported`). */
export function firstReviewHint(firstReview: FirstReview | null): string {
  if (!firstReview || firstReview.analysisStatus !== "done") return "Your first review is being prepared.";
  const n = firstReview.momentsCount;
  if (n === null) return "Your first review is ready. It's first on Home.";
  if (n === 0) return "Your last game was clean. Nice.";
  return `The coach found ${formatCount(n)} ${n === 1 ? "moment" : "moments"} in your last game. They're first on Home.`;
}

function failedHint(run: RunView): { hint: string; retry: boolean; settingsLink: boolean } {
  const name = providerName(run.provider);
  switch (run.error?.code) {
    case "not_found":
      return { hint: `${name} can't find this account any more. Check it in`, retry: false, settingsLink: true };
    case "closed":
      return { hint: `${name} says this account is closed. Check it in`, retry: false, settingsLink: true };
    default:
      return { hint: `${name} stopped answering. We'll retry in the background, or you can now.`, retry: true, settingsLink: false };
  }
}

/** The card for the current run (§4.7, §4.8). */
export function importCardView(input: ImportCardInput): ImportCardView {
  const { context, run } = input;
  const base = { tone: "neutral" as const, retry: false, settingsLink: false, count: null, bar: null };
  const active = run && run.status !== "cancelled" ? run : null;

  if (!active) {
    if (input.linked.length === 0) {
      return { ...base, state: "none", boardState: null, label: "Your games", hint: "Link Chess.com or Lichess any time in", settingsLink: true };
    }
    if (!input.entitled) return waiting(input);
    return { ...base, state: "queued", boardState: "importing", label: "Importing games", bar: { kind: "indeterminate", text: "Starting" }, hint: `Starting the import. ${tail(context)}` };
  }

  switch (active.status) {
    case "waiting_for_membership":
      return waiting(input);
    case "queued": {
      const paused = active.error?.code === "rate_limited";
      return {
        ...base,
        state: "queued",
        boardState: "importing",
        label: "Importing games",
        count: active.imported > 0 && active.total ? `${formatCount(active.imported)} / ${formatCount(active.total)}` : null,
        bar: { kind: "indeterminate", text: paused ? "Paused" : "Starting" },
        hint: paused
          ? `${providerName(active.provider)} asked us to slow down; the import carries on by itself. ${tail(context)}`
          : `Starting the import. ${tail(context)}`,
      };
    }
    case "running": {
      if (active.phase === "saving" && active.total !== null && active.total > 0) {
        const eta = context === "done" ? etaLabel(input.etaSec) : null;
        return {
          ...base,
          state: "saving",
          boardState: "importing",
          label: "Importing games",
          count: `${formatCount(Math.min(active.imported, active.total))} / ${formatCount(active.total)}`,
          bar: { kind: "determinate", value: Math.min(active.imported, active.total), max: active.total },
          hint: eta ? `${eta} left. ${DONE_TAIL}` : tail(context),
        };
      }
      return {
        ...base,
        state: "reading",
        boardState: "importing",
        label: `Importing games · ${formatCount(active.seen)} found`,
        bar: { kind: "indeterminate", text: `${formatCount(active.seen)} games found` },
        hint: tail(context),
      };
    }
    case "done":
      if (active.imported === 0) {
        return { ...base, state: "empty", boardState: "imported", label: "Imported", count: games(0), hint: "Nothing to import yet. Your first game here starts your Mistake Bank." };
      }
      return { ...base, state: "imported", boardState: "imported", label: "Imported", count: games(active.imported), hint: firstReviewHint(input.firstReview) };
    case "failed": {
      const label =
        active.total !== null && active.total > 0
          ? `Import stopped at ${formatCount(active.imported)} of ${formatCount(active.total)}`
          : `Import stopped at ${games(active.imported)}`;
      return { ...base, state: "failed", boardState: "import_failed", tone: "bad", label, ...failedHint(active) };
    }
    default:
      return waiting(input);
  }
}

function waiting(input: ImportCardInput): ImportCardView {
  const what = input.trial ? "your trial" : "your membership";
  return {
    state: "waiting",
    boardState: "importing",
    label: "Importing games",
    count: null,
    tone: "neutral",
    bar: null,
    hint: input.context === "activating" ? `Waiting for ${what} to start. ${ACTIVATING_TAIL}` : `Starts as soon as ${what} is confirmed.`,
    retry: false,
    settingsLink: false,
  };
}
