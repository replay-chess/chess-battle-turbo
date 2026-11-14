// /train/bank/session (phase-05 plan §4.4, §5.2 S4): the Mistake Bank drill (TrainerRunner, bank mode). `?s=<ref>` resumes; every other entry param creates or
// resumes a session server-side (features/train/session-spec.ts lists them). See runner-page.server.tsx.
import { RunnerPage } from "@/components/train/runner/runner-page.server";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function BankSessionPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <RunnerPage route="/train/bank/session" searchParams={await searchParams} />;
}
