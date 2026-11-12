"use client";

// CoachLine (plan §4.1): the `C` avatar and the template sentences. While the narration plays, the sentence being
// spoken gets the amber wash plus weight and the others dim (never colour alone, §8.10). The VERIFIED tag shows only
// when the text passed the LLM verifier (P7: textStatus "ready" and every sentence `v`), never for template text
// (P3-D16). The narration controls load lazily (§9.6) and only where the Web Speech API exists.

import dynamic from "next/dynamic";
import type { Sentence, TextStatus } from "@repo/contracts/http/review";
import { useReview } from "../context";
import { useNarration } from "../useNarration";

const NarrationControls = dynamic(() => import("./NarrationControls"), { ssr: false });

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

export function CoachLine({
  sentences,
  textStatus,
  context,
}: {
  sentences: readonly Sentence[];
  textStatus: TextStatus | null;
  context: "summary" | "moment";
}) {
  const { narrator } = useReview();
  const narration = useNarration();
  const narrating = narration.status === "playing" || narration.status === "paused";
  const verified = textStatus === "ready" && sentences.length > 0 && sentences.every((s) => s.v);
  return (
    <div className="rv-coach" data-testid="coach-line">
      <span className="rv-av" data-ink="" data-size="28" aria-hidden="true">
        C
      </span>
      <div className="rv-coach__body">
        <p className="rv-coach__text" data-narrating={narrating ? "" : undefined}>
          {sentences.map((s, i) => (
            <span key={i} className="rv-sent" data-on={narrating && i === narration.sentence ? "" : undefined}>
              {s.t}{" "}
            </span>
          ))}
        </p>
        {verified ? (
          <span className="rv-ver">
            <CheckIcon />
            VERIFIED
          </span>
        ) : null}
        {narrator ? <NarrationControls context={context} /> : null}
      </div>
    </div>
  );
}
