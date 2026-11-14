// A TrainState for unit tests without a database (defaults, an empty day): what `loadTrainState` returns for a member
// with no rows at `now`. Imported by *.test.ts only.
import { DEFAULT_BANK_DAILY_CAP } from "@repo/chess-training/constants";
import { ZERO_DAY } from "./badges.server";
import { trainClock, type TrainState } from "./day.server";
import { defaultProfile } from "./profile.server";

export function loadTrainStateFromRows(now: Date, timeZone = "UTC"): TrainState {
  const profile = { ...defaultProfile({ r: 1500, rd: 250, vol: 0.06 }), bankDailyCap: DEFAULT_BANK_DAILY_CAP };
  return {
    profile,
    clock: trainClock(now, timeZone, profile),
    due: { dueReview: 0, dueNew: 0, total: 0, nextAt: null, nextBatchAt: null, nextBatch: 0 },
    today: undefined,
    counters: ZERO_DAY,
    week: [],
  };
}
