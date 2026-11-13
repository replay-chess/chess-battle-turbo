// /dev/ui/onboarding/link?state= (V3OnbLink): the seven board states, then the undrawn rows (linked_elsewhere,
// upstream, invalid, lichess_error, lichess_pending, found_no_games).
import { LinkStep } from "@/components/onboarding/LinkStep";
import type { ChessComCardState, FoundSummary, LichessCardState } from "@/lib/onboarding/link-state";
import { STRESS_NAME, type OnboardingDemo } from "./types";

const found = (stress: boolean, games = 480): FoundSummary => ({
  username: stress ? STRESS_NAME.toLowerCase() : "knightowl_88",
  displayUsername: stress ? STRESS_NAME : "knightowl_88",
  headline: games > 0 ? { timeClass: "rapid", rating: 1184 } : null,
  totalRatedGames: stress && games > 0 ? 48_213 : games,
});

function cardOf(state: string, stress: boolean): { card: ChessComCardState; typed: string; lichess: LichessCardState } {
  const name = stress ? STRESS_NAME : "knightowl_88";
  switch (state) {
    case "validating":
      return { card: { kind: "validating" }, typed: name, lichess: { kind: "idle" } };
    case "found":
      return { card: { kind: "found", found: found(stress) }, typed: name, lichess: { kind: "idle" } };
    case "found_no_games":
      return { card: { kind: "found", found: found(stress, 0) }, typed: name, lichess: { kind: "idle" } };
    case "not_found":
      return { card: { kind: "not_found", typed: stress ? STRESS_NAME : "knightowl88" }, typed: stress ? STRESS_NAME : "knightowl88", lichess: { kind: "idle" } };
    case "invalid":
      return { card: { kind: "invalid", typed: "no spaces" }, typed: "no spaces", lichess: { kind: "idle" } };
    case "private_profile":
      return { card: { kind: "private_profile" }, typed: "quiet_rook", lichess: { kind: "idle" } };
    case "rate_limited":
      return { card: { kind: "rate_limited" }, typed: name, lichess: { kind: "idle" } };
    case "linked_elsewhere":
      return { card: { kind: "linked_elsewhere" }, typed: name, lichess: { kind: "idle" } };
    case "upstream":
      return { card: { kind: "upstream" }, typed: name, lichess: { kind: "idle" } };
    case "lichess_denied":
      return { card: { kind: "default" }, typed: "", lichess: { kind: "denied" } };
    case "lichess_error":
      return { card: { kind: "default" }, typed: "", lichess: { kind: "error", reason: "already_linked" } };
    case "lichess_pending":
      return { card: { kind: "default" }, typed: "", lichess: { kind: "connecting" } };
    default:
      return { card: { kind: "default" }, typed: "", lichess: { kind: "idle" } };
  }
}

export const linkDemo: OnboardingDemo = {
  page: "link",
  board: "V3OnbLink",
  states: [
    "default",
    "validating",
    "found",
    "not_found",
    "private_profile",
    "rate_limited",
    "lichess_denied",
    "found_no_games",
    "invalid",
    "linked_elsewhere",
    "upstream",
    "lichess_error",
    "lichess_pending",
  ],
  render: (state, { stress }) => {
    const { card, typed, lichess } = cardOf(state, stress);
    return <LinkStep demo initialUsername={typed} initialState={card} lichess={lichess} demoCountdown="0:30" />;
  },
};
