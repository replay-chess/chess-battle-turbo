"use client";

// The live Home (phase-05 plan §4.1, §5.2 S1): reads qk.home() (seeded by the page, so first paint makes no request),
// listens on the user room (handlers/home.ts for the import and analysis rows; handlers/train.ts for the bank counts,
// both throttled to one refetch per 30 s), and reports `home_viewed` once per mount. A failed refetch keeps the cached
// screen; only a query with no data at all shows ErrorState (unlikely: the RSC seeds it). 402 on a refetch goes to the
// paywall through P1's reactToApiError (QueryProvider).
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/data/ErrorState";
import { homeQuery } from "@/lib/api/queries/home";
import { trackTrain } from "@/lib/analytics/train-events";
import { homeRefetchInvalidator, useHomeEvents } from "@/lib/realtime/handlers/home";
import { useTrainEvents } from "@/lib/realtime/handlers/train";
import { homeViewState } from "./copy";
import { HomeSkeleton } from "./HomeSkeleton";
import { HomeView, type HomeTrack } from "./HomeView";

const BANK_REFETCH = homeRefetchInvalidator("bank");

const TRACK: HomeTrack = {
  continueClicked: (kind) => trackTrain("home_continue_clicked", { kind }),
  bankCtaClicked: (due) => trackTrain("home_bank_cta_clicked", { due: Math.min(due, 10_000) }),
  importClicked: (surface) => trackTrain("home_import_clicked", { surface }),
};

export function HomeScreen({ profileHref }: { profileHref: string }) {
  const q = useQuery(homeQuery());
  useHomeEvents();
  // The bank-count events' Home refetches count as home.refetch{cause: "bank"} (plan §10.2).
  useTrainEvents({ invalidate: BANK_REFETCH });

  const viewed = useRef(false);
  const data = q.data;
  useEffect(() => {
    if (viewed.current || !data) return;
    viewed.current = true;
    trackTrain("home_viewed", { state: homeViewState(data), due: Math.min(data.bank.due, 10_000), has_continue: data.continue !== null });
  }, [data]);

  if (data) return <HomeView data={data} profileHref={profileHref} track={TRACK} />;
  if (q.isPending) return <HomeSkeleton />;
  return (
    <div className="flex h-full min-h-0 items-center justify-center" data-rc-lock="">
      <ErrorState error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} object="your home page" />
    </div>
  );
}
