// Provider time classes → P2's stored `TimeClass` (phase-04 plan §8.6, §8.7; data-model `TimeClass` enum):
//
// | Chess.com `time_class` | Lichess `speed`      | TimeClass  |
// |------------------------|----------------------|------------|
// | bullet                 | ultraBullet, bullet  | BULLET     |
// | blitz                  | blitz                | BLITZ      |
// | rapid                  | rapid                | RAPID      |
// | —                      | classical            | CLASSICAL  |
// | daily                  | correspondence       | DAILY      |
//
// Anything else returns null and the mapper skips the game as `parse_error` (an unknown class is a provider change,
// which the canary reports in strict mode).
import type { TimeClass } from "@repo/game-core/rules/timeClass";

export type { TimeClass };

export const CHESSCOM_TIME_CLASSES = ["bullet", "blitz", "rapid", "daily"] as const;
export type ChessComTimeClass = (typeof CHESSCOM_TIME_CLASSES)[number];

export const LICHESS_SPEEDS = ["ultraBullet", "bullet", "blitz", "rapid", "classical", "correspondence"] as const;
export type LichessSpeed = (typeof LICHESS_SPEEDS)[number];

/** The `perfType` list of the worker's export request (§7.8): every standard speed, no variants. */
export const LICHESS_PERF_TYPES = LICHESS_SPEEDS.join(",");

const CHESSCOM: Record<ChessComTimeClass, TimeClass> = {
  bullet: "BULLET",
  blitz: "BLITZ",
  rapid: "RAPID",
  daily: "DAILY",
};

const LICHESS: Record<LichessSpeed, TimeClass> = {
  ultraBullet: "BULLET",
  bullet: "BULLET",
  blitz: "BLITZ",
  rapid: "RAPID",
  classical: "CLASSICAL",
  correspondence: "DAILY",
};

export function chessComTimeClass(value: string): TimeClass | null {
  return Object.hasOwn(CHESSCOM, value) ? CHESSCOM[value as ChessComTimeClass] : null;
}

export function lichessTimeClass(speed: string): TimeClass | null {
  return Object.hasOwn(LICHESS, speed) ? LICHESS[speed as LichessSpeed] : null;
}

/**
 * The `RatingsV1` bucket a rating pool folds into (§6.4: Lichess `ultraBullet` → `bullet`, `correspondence` →
 * `daily`).
 */
export type RatingBucket = "bullet" | "blitz" | "rapid" | "classical" | "daily";

export function ratingBucketOf(tc: TimeClass): RatingBucket | null {
  switch (tc) {
    case "BULLET":
      return "bullet";
    case "BLITZ":
      return "blitz";
    case "RAPID":
      return "rapid";
    case "CLASSICAL":
      return "classical";
    case "DAILY":
      return "daily";
    case "UNTIMED":
      return null;
  }
}
