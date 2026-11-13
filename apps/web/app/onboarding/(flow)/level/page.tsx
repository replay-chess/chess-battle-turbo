// /onboarding/level (phase-04 plan §4.4, §8.2). Server: the guard, the band suggestion and the back target.
//
// The suggestion comes from the stored `ratingBandSource` (`chesscom:rapid`, written with the link, D4-15) and that
// account's ratings; when the member had overridden it (`self`) or nothing was stored, it is computed from the
// first active link that has rated games. No link (or no games) → the manual state.
import { LevelStep } from "@/components/onboarding/LevelStep";
import { levelBackHref, levelSuggestion, loadStepPage } from "@/lib/data/onboarding";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function LevelPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { state } = await loadStepPage("level", await searchParams);
  const suggestion = levelSuggestion(state);
  return <LevelStep suggestion={suggestion} initialBand={state.ratingBand ?? suggestion?.band ?? null} backHref={levelBackHref(state)} />;
}
