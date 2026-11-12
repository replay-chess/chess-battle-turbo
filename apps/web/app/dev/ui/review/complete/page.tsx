import type { Metadata } from "next";
import { reviewCompleteFixture } from "@repo/contracts/http/fixtures/review";
import { ViewportStage } from "@/components/layout/ViewportStage";
import { AppShellView } from "@/components/shell/AppShellView";
import { CompleteView, type CompleteLinks } from "@/features/review/complete/CompleteView";
import { isCompleteDemoState } from "@/features/review/demo/states";
import { stressComplete } from "@/features/review/demo/stress";
import { stageUser } from "../../stage/demo-data";

export const metadata: Metadata = { title: "Review Complete Demo", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Demo links stay on the demo routes (no server behind them). */
const DEMO_LINKS: CompleteLinks = {
  playAgain: "/dev/ui/review?state=summary",
  share: "/dev/ui/review/share?state=ready",
  reviewAgain: "/dev/ui/review?state=moment&m=1",
  games: "/dev/ui/review",
  review: "/dev/ui/review?state=summary",
  moment: (n) => `/dev/ui/review?state=moment&m=${n}`,
};

/**
 * `/dev/ui/review/complete` (phase-03 plan §4.10): the real complete page on the contract fixtures. Params:
 *   state=<default|nothing|partial|noMoments>   (default: default)
 *   stress=1      20-character names, the longest captions, three-digit move numbers
 *   share=0       review-share off (no Share Analysis row)
 *   chrome=none   no app shell        device=…   accepted for the device suite
 */
export default async function CompleteDemoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = await searchParams;
  const s = one(p.state);
  const state = isCompleteDemoState(s) ? s : "default";
  const view = one(p.stress) === "1" && (state === "default" || state === "partial") ? stressComplete() : reviewCompleteFixture(state);
  const shareOff = one(p.share) === "0";
  const demo = <CompleteView view={{ ...view, shareEnabled: !shareOff && view.shareEnabled }} links={{ ...DEMO_LINKS, share: shareOff ? null : DEMO_LINKS.share }} />;
  if (one(p.chrome) === "none") return <ViewportStage>{demo}</ViewportStage>;
  return (
    <AppShellView
      user={stageUser({ payment: false, stress: false })}
      demo
      hideTabBar
      currentKey="review"
      backTo={{ key: "review", href: "/dev/ui/review", label: "Review" }}
      navFlags={{ "review-v3": true }}
    >
      {demo}
    </AppShellView>
  );
}
