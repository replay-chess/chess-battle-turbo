import type { Metadata } from "next";
import Link from "next/link";
import { ViewportStage } from "@/components/layout/ViewportStage";
import { AppShellView } from "@/components/shell/AppShellView";
import { ReviewDemo } from "@/features/review/demo/ReviewDemo";
import {
  COMPLETE_DEMO_STATES,
  isMomentDemoPhase,
  isReviewDemoState,
  MOMENT_DEMO_PHASES,
  REVIEW_DEMO_STATES,
  SHARE_DEMO_STATES,
} from "@/features/review/demo/states";
import { GalleryFrame } from "../_components/Specimen";
import { stageUser } from "../stage/demo-data";

export const metadata: Metadata = { title: "Review Demo", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * `/dev/ui/review` (phase-03 plan §4.10): the real review screen in each state, on the contract fixtures, with no
 * server and no socket. Fails closed outside dev/test (app/dev/layout.tsx). Params:
 *   state=<none|queued|running|analysing|writing|failed|terminal|skipped|done|summary|moves|clean|clean_loss|
 *          no_moments|moment>   (analysing = running, summary = done: the design's names)
 *   phase=<ask|tried|pickLine|found|found_retry|reveal|line>   with state=moment; m=1..3 picks the moment
 *   live=1      queued → progress frames (the socket's cache updater) → writing → done, auto-advancing
 *   stress=1    20-character names, a 120-ply game with three-digit move numbers, the longest opening (testing X9)
 *   side=b      the viewer plays Black (stress)   share=1    the review-share menu item   flip=1   board flipped
 *   bank=1      P5: A1 with the `train` bank fields (the key moment's Mistake Bank checkbox and B)
 *   device=…    accepted for the device suite (the viewport decides the layout)   chrome=none   no app shell
 * The complete and share pages have their own demos: /dev/ui/review/complete, /dev/ui/review/share.
 */
export default async function ReviewDemoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = await searchParams;
  const state = one(p.state);
  const live = one(p.live) === "1";
  if (!isReviewDemoState(state) && !live) return <StateIndex />;
  const phase = one(p.phase);
  const m = Number(one(p.m) ?? "");
  const props = {
    state: isReviewDemoState(state) ? state : ("queued" as const),
    live,
    share: one(p.share) === "1",
    flip: one(p.flip) === "1",
    // `?m=` opens that moment from any done state too, as on the real route (a reload keeps the moment).
    moment: Number.isInteger(m) && m >= 1 && m <= 3 ? m : null,
    phase: isMomentDemoPhase(phase) ? phase : ("ask" as const),
    stress: one(p.stress) === "1",
    side: one(p.side) === "b" ? ("b" as const) : ("w" as const),
    bank: one(p.bank) === "1",
  };
  const demo = <ReviewDemo key={JSON.stringify(props)} {...props} />;
  if (one(p.chrome) === "none") return <ViewportStage>{demo}</ViewportStage>;
  return (
    <AppShellView
      user={stageUser({ payment: false, stress: false })}
      demo
      hideTabBar
      currentKey="review"
      backTo={{ key: "review", href: "/dev/ui/games", label: "My Games" }}
      navFlags={{ "review-v3": true }}
    >
      {demo}
    </AppShellView>
  );
}

function StateIndex() {
  const link = (href: string, text: string) => (
    <li key={href}>
      <Link className="font-mono text-label underline" href={href} prefetch={false}>
        {text}
      </Link>
    </li>
  );
  return (
    <GalleryFrame title="Review Demo">
      <p className="mb-4 text-body text-cb-text-soft">The review screens in each state (phase-03 plan §4.1–4.3), on the design fixtures.</p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-1" data-testid="review-demo-index">
        {REVIEW_DEMO_STATES.map((s) => link(`/dev/ui/review?state=${s}`, s))}
        {MOMENT_DEMO_PHASES.map((ph) => link(`/dev/ui/review?state=moment&phase=${ph}`, `moment · ${ph}`))}
        {link("/dev/ui/review?live=1", "live=1")}
        {link("/dev/ui/review?state=summary&stress=1", "summary · stress=1")}
        {link("/dev/ui/review?state=moment&phase=reveal&stress=1&side=b", "moment · stress=1 · black")}
        {COMPLETE_DEMO_STATES.map((s) => link(`/dev/ui/review/complete?state=${s}`, `complete · ${s}`))}
        {SHARE_DEMO_STATES.map((s) => link(`/dev/ui/review/share?state=${s}`, `share · ${s}`))}
      </ul>
    </GalleryFrame>
  );
}
