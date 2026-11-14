"use client";

// The coach line (V3BankSession `hasCoach`): "C" avatar, the text and the VERIFIED tag when the text is verified
// (the deterministic explainer or P7's checked text). Tone: good after a solve, bad after a wrong move.
import { Check } from "lucide-react";
import type { CoachTone } from "@/features/train/machine";

export function CoachLine({ text, tone, verified }: { text: string; tone: CoachTone; verified: boolean }) {
  return (
    <div className="tr-coach tr-fadein" data-tone={tone} data-testid="trainer-coach">
      <span className="tr-coach__av" aria-hidden="true">
        C
      </span>
      <div className="tr-coach__body">
        <p>
          <span className="tr-vh">Coach: </span>
          {text}
        </p>
        {verified ? (
          <span className="tr-ver" style={{ alignSelf: "flex-start" }}>
            <Check aria-hidden="true" size={10} strokeWidth={3} />
            VERIFIED
          </span>
        ) : null}
      </div>
    </div>
  );
}
