// /dev/ui/onboarding/level?state= (V3OnbRating): prefilled, manual, then new_to_chess (no puzzle) and
// lichess (the Lichess offset applied).
import { LevelStep } from "@/components/onboarding/LevelStep";
import { suggestBand } from "@/lib/onboarding/suggest-band";
import type { OnboardingDemo } from "./types";

const CHESSCOM = { rapid: { rating: 1184, games: 312 }, blitz: { rating: 1032, games: 141 }, bullet: { rating: 871, games: 27 } };
const LICHESS = { blitz: { rating: 1650, games: 400 }, rapid: { rating: 1580, games: 60 } };

export const levelDemo: OnboardingDemo = {
  page: "level",
  board: "V3OnbRating",
  states: ["prefilled", "manual", "new_to_chess", "lichess"],
  render: (state) => {
    if (state === "manual") return <LevelStep demo suggestion={null} initialBand={null} backHref="/onboarding/link" />;
    if (state === "new_to_chess") return <LevelStep demo suggestion={null} initialBand="NEW_TO_CHESS" backHref="/onboarding/link" />;
    const provider: "chesscom" | "lichess" = state === "lichess" ? "lichess" : "chesscom";
    const s = suggestBand(provider === "lichess" ? LICHESS : CHESSCOM, provider);
    const suggestion = s ? { ...s, provider } : null;
    return <LevelStep demo suggestion={suggestion} initialBand={suggestion?.band ?? null} backHref="/onboarding/confirm?provider=chesscom&u=knightowl_88" />;
  },
};
