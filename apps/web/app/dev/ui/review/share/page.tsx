import type { Metadata } from "next";
import { ViewportStage } from "@/components/layout/ViewportStage";
import { AppShellView } from "@/components/shell/AppShellView";
import { isShareDemoState } from "@/features/review/demo/states";
import { ShareDemo } from "@/features/share/ShareDemo";
import { stageUser } from "../../stage/demo-data";

export const metadata: Metadata = { title: "Share Demo", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * `/dev/ui/review/share` (phase-03 plan §4.10): the real share screen on the contract fixtures, with no server.
 *   state=<generating|ready|copied|error|rate_limited|revoked>   (default: ready)
 *   anon=1        Show My Username off      stress=1   20-character names, the 120-ply stress game
 *   chrome=none   no app shell              device=…   accepted for the device suite
 */
export default async function ShareDemoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = await searchParams;
  const s = one(p.state);
  const props = {
    state: isShareDemoState(s) ? s : ("ready" as const),
    anon: one(p.anon) === "1",
    stress: one(p.stress) === "1",
  };
  const demo = <ShareDemo key={JSON.stringify(props)} {...props} />;
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
