"use client";

// /dev/ui/review/share (phase-03 plan §4.10): the real ShareScreen with the review cache seeded from the contract
// fixture (GAME, done) or the stress game, and the link state seeded per `?state=`. Nothing is sent.
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { reviewFixture, shareFixture } from "@repo/contracts/http/fixtures/review";
import { qk } from "@/lib/api/keys";
import type { ShareDemoState } from "@/features/review/demo/states";
import { stressReview } from "@/features/review/demo/stress";
import { ShareScreen } from "./ShareScreen";

export function ShareDemo({ state, anon, stress }: { state: ShareDemoState; anon: boolean; stress: boolean }) {
  const qc = useQueryClient();
  const [ref] = useState(() => {
    const dto = stress ? stressReview("w") : reviewFixture("done");
    qc.setQueryData(qk.review.detail(dto.ref), dto);
    return dto.ref;
  });
  return <ShareScreen refId={ref} from="review_menu" demo={{ state, share: shareFixture({ showUsername: !anon }) }} />;
}
