// /onboarding/goals (phase-04 plan §4.5, §8.3). Server: the guard and the saved goals / minutes (the board's
// default pair, Stop blundering + Study legends at 10 min, when nothing is saved yet). The preview is pure
// (previewDay()), so the page makes no other read.
import { GoalsStep } from "@/components/onboarding/GoalsStep";
import { loadStepPage } from "@/lib/data/onboarding";
import { initialGoalsState } from "@/lib/onboarding/day-preview";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function GoalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { state } = await loadStepPage("goals", await searchParams);
  const initial = initialGoalsState(state);
  return <GoalsStep initialGoals={initial.goals} initialMinutes={initial.dailyMinutes} />;
}
