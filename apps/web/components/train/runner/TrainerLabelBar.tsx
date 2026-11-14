"use client";

// The label lines above and below the board (V3BankSession / V3Puzzle* `.pbar`):
//   top, side mode   [THEME] vs tal_fan_77 · today · move 19              Streak 4 · streak reset
//                    (puzzles: Rating 1524 +12 · Streak 5)
//   top, phones      the status block: "White to move" + the rating line, then "THEME · source" (V3iPhonePuzzle)
//   bottom           You play White · In the game you played b3 · See It in Your Game (stack mode, FIX-2: the bank's
//                    bar shows under the board on phones and iPad portrait too, "You play White · See It in Your Game")
import Link from "next/link";
import type { TrainItem } from "@repo/contracts/http/train";
import type { PuzzleRatingState } from "@repo/contracts/http/train";
import { trackTrain } from "@/lib/analytics/train-events";

export function ratingLine(mode: "bank" | "puzzles", streak: number, rating: PuzzleRatingState | null, delta: number | null): string {
  if (mode === "bank" || !rating) return `Streak ${streak}`;
  const d = delta ? ` ${delta > 0 ? "+" : "−"}${Math.abs(delta)}` : "";
  return `Rating ${Math.round(rating.value)}${d} · Streak ${streak}`;
}

/**
 * The phone status block's rating line (FIX-2): after a miss "Streak 0 · streak reset" says the same thing twice and
 * was cut at 393 px ("… · streak r…"), so the phone line reads "Rating 1512 · streak reset" (bank: "Streak reset").
 */
export function phoneRatingLine(rating: string, streakReset: boolean): { lead: string; reset: boolean } {
  if (!streakReset) return { lead: rating, reset: false };
  const lead = rating.replace(/(?:^| · )Streak \d+$/, "");
  return { lead, reset: true };
}

export function TopLabelBar({
  item,
  status,
  rating,
  streakReset,
}: {
  item: TrainItem;
  status: string;
  rating: string;
  streakReset: boolean;
}) {
  const phone = phoneRatingLine(rating, streakReset);
  return (
    <div className="tr-lbar" data-pos="top" data-testid="trainer-label-top">
      <span className="tr-lbar__side tr-lbar__who" style={{ display: "inline-flex" }}>
        <span className="tr-lbl tr-lbar__theme">{item.theme.label}</span>
        <span className="tr-lbar__src">{item.sourceLabel}</span>
      </span>
      <span className="tr-lbar__side tr-lbar__rating tr-mono" data-testid="trainer-rating">
        {rating}
        {streakReset ? <span className="tr-reset"> · streak reset</span> : null}
      </span>
      <div className="tr-lbar__phone" aria-hidden="true">
        <div className="tr-lbar__phone-row">
          <span className="tr-lbar__status">{status}</span>
          <span className="tr-lbar__rating tr-mono">
            {phone.lead}
            {phone.reset ? <span className="tr-reset">{phone.lead ? " · streak reset" : "Streak reset"}</span> : null}
          </span>
        </div>
        <span className="tr-lbl tr-lbar__src2">
          {item.theme.label} · {item.sourceLabel}
        </span>
      </div>
    </div>
  );
}

/** "See It in Your Game": the item's game at its ply in the review (a bank item only; the demo keeps it on /dev). */
export function seeInGameHref(item: TrainItem, demo: boolean): string | null {
  const ctx = item.context;
  if (!ctx) return null;
  if (demo) return "#see-in-game";
  return `/review/${encodeURIComponent(ctx.gameRef)}${ctx.gamePly !== null ? `?ply=${ctx.gamePly}&from=bank` : "?from=bank"}`;
}

export function BottomLabelBar({ item, side, demo }: { item: TrainItem; side: "w" | "b"; demo: boolean }) {
  const ctx = item.context;
  const href = seeInGameHref(item, demo);
  return (
    <div className="tr-lbar" data-pos="bottom" data-game={ctx && href ? "" : undefined} data-testid="trainer-label-bottom">
      <span style={{ whiteSpace: "nowrap" }}>You play {side === "w" ? "White" : "Black"}</span>
      {ctx && href ? (
        <span className="tr-lbar__ingame">
          <span className="tr-lbar__played">
            In the game you played <span className="tr-mono">{ctx.playedSan}</span> ·{" "}
          </span>
          <Link href={href} prefetch={false} onClick={() => trackTrain("bank_see_in_game_clicked", {})} data-testid="trainer-see-in-game">
            See It in Your Game
          </Link>
        </span>
      ) : null}
    </div>
  );
}
