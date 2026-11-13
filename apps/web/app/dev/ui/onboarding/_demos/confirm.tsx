// /dev/ui/onboarding/confirm?state= (V3OnbPreview): default, loading, no_games, then the undrawn rows
// (recent_failed, unavailable, private, lichess).
import { lookupFoundFixture, lookupNoGamesFixture, lookupPrivateFixture } from "@repo/contracts/http/fixtures/p04";
import type { LookupData } from "@repo/contracts/http/accounts";
import { ConfirmStep, type ConfirmView, type RecentRow } from "@/components/onboarding/ConfirmStep";
import { STRESS_NAME, STRESS_OPENING, type OnboardingDemo } from "./types";

const RECENT: RecentRow[] = [
  { result: "loss", opponentName: "tal_fan_77", opponentRating: 1203, openingName: "Two Knights Defence", dayLabel: "Today" },
  { result: "win", opponentName: "e4_enjoyer", opponentRating: 1166, openingName: "Sicilian: Alapin", dayLabel: "Oct 27" },
  { result: "loss", opponentName: "pawnstorm22", opponentRating: 1221, openingName: "QGD: Exchange", dayLabel: "Oct 27" },
  { result: "draw", opponentName: "bishop_pair_bob", opponentRating: 1178, openingName: "Caro-Kann: Advance", dayLabel: "Oct 26" },
  { result: "win", opponentName: "lucena_now", opponentRating: 1192, openingName: "London System", dayLabel: "Oct 25" },
];

const DESIGN: LookupData = {
  ...lookupFoundFixture,
  profile: { ...lookupFoundFixture.profile, username: "knightowl_88", displayUsername: "knightowl_88", countryCode: "PT", joinedAt: "2021-03-02T00:00:00.000Z" },
};

function stressed(a: LookupData): LookupData {
  return {
    ...a,
    profile: { ...a.profile, username: STRESS_NAME.toLowerCase(), displayUsername: STRESS_NAME },
    ratings: { rapid: { rating: 2895, best: 2911, games: 31_204 }, blitz: { rating: 3012, best: 3100, games: 48_213 }, bullet: { rating: 3150, best: 3200, games: 12_009 }, daily: { rating: 2213, best: 2300, games: 1_204 } },
    totalRatedGames: 92_630,
  };
}

function viewOf(state: string, stress: boolean): { view: ConfirmView; provider: "chesscom" | "lichess" } {
  const recent = stress ? RECENT.map((r) => ({ ...r, opponentName: STRESS_NAME, opponentRating: 2999, openingName: STRESS_OPENING })) : RECENT;
  const account = stress ? stressed(DESIGN) : DESIGN;
  switch (state) {
    case "loading":
      return { view: { state: "loading" }, provider: "chesscom" };
    case "no_games":
      return { view: { state: "ready", account: lookupNoGamesFixture, recent: [] }, provider: "chesscom" };
    case "recent_failed":
      return { view: { state: "ready", account, recent: null }, provider: "chesscom" };
    case "unavailable":
      return { view: { state: "unavailable" }, provider: "chesscom" };
    case "private":
      return { view: { state: "ready", account: lookupPrivateFixture, recent: [] }, provider: "chesscom" };
    case "lichess":
      return {
        view: {
          state: "ready",
          account: { ...account, ratings: { ...account.ratings, classical: { rating: 1490, best: 1520, games: 12 } } },
          recent,
        },
        provider: "lichess",
      };
    default:
      return { view: { state: "ready", account, recent }, provider: "chesscom" };
  }
}

export const confirmDemo: OnboardingDemo = {
  page: "confirm",
  board: "V3OnbPreview",
  states: ["default", "loading", "no_games", "recent_failed", "unavailable", "private", "lichess"],
  render: (state, { stress }) => {
    const { view, provider } = viewOf(state, stress);
    return <ConfirmStep demo provider={provider} username={provider === "chesscom" ? "knightowl_88" : null} view={view} />;
  },
};
