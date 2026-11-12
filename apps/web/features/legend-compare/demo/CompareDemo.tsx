"use client";

// /dev/ui/compare (phase-03 plan §4.10): the real CompareScreen on the contract fixtures, with no server. The query
// cache is seeded with the state's payload (and, for the Explanation tab, the fixture's five-segment narration with a
// generated silent WAV as its audio, so Play, the progress bar and the board cues run). The page's one A9b is replaced
// by a timer that flips the payload to `ready` with the evals, as `compare:ready` → refetch would.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { legendCompareFixture } from "@repo/contracts/http/fixtures/review";
import { qk } from "@/lib/api/keys";
import { CompareScreen } from "../CompareScreen";
import { narrationLength } from "../explanation";
import { compareDemoDto, compareDemoExplanation, silentWav, type CompareDemoState } from "./states";

/** How long the demo's simulated compute takes. */
export const DEMO_COMPUTE_MS = 1500;

let audioUrl: string | null = null;

/** One silent WAV per tab for every demo state (never revoked: a remount must not hand the player a dead URL). */
function demoAudioUrl(seconds: number): string {
  audioUrl ??= URL.createObjectURL(new Blob([silentWav(seconds)], { type: "audio/wav" }));
  return audioUrl;
}

export function CompareDemo({ state, tab, stress }: { state: CompareDemoState; tab: string | null; stress: boolean }) {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const ref = legendCompareFixture().ref;

  useEffect(() => {
    const dto = compareDemoDto(state, stress);
    const explanation = compareDemoExplanation();
    const audio = demoAudioUrl(narrationLength(explanation));
    qc.setQueryData(qk.review.legend(ref), dto);
    if (dto.hasExplanation) {
      qc.setQueryData([...qk.review.legend(ref), "explanation"], { ...dto, explanation, audioUrl: audio });
    } else {
      qc.removeQueries({ queryKey: [...qk.review.legend(ref), "explanation"], exact: true });
    }
    setReady(true);
    return () => {
      qc.removeQueries({ queryKey: qk.review.legend(ref) });
    };
  }, [qc, ref, state, stress]);

  if (!ready) return null;
  return (
    <CompareScreen
      refId={ref}
      initial={{ tab, ply: null }}
      from="review_menu"
      flags={{ share: true }}
      demo={{
        loading: state === "loading",
        audioFailed: state === "audio_failed",
        compute: () => {
          setTimeout(() => {
            const done = compareDemoDto("default", stress);
            qc.setQueryData(qk.review.legend(ref), { ...done, attempts: Math.min(3, done.attempts + 1) });
          }, DEMO_COMPUTE_MS);
        },
      }}
    />
  );
}
