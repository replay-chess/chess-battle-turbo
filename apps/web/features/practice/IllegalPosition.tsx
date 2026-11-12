"use client";

// `/practice?fen=` with a position that fails validation (phase-03 plan §4.8 error `illegal_fen`, §11.2 rule 6: legal,
// one king each, the side not to move not in check). The App Router cannot set a 400 status from a page, so this is
// the 400 *page* (`noindex`); PR1 answers a real 400 `validation_failed` (`details.reason: "illegal_position"`).
// Back returns to the previous page when there is one, else to /play.
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function IllegalPosition() {
  const router = useRouter();
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6" data-testid="practice-illegal">
      <div className="flex max-w-[480px] flex-col items-start gap-4">
        <span className="font-mono text-label font-medium tracking-[0.12em] text-cb-text-soft uppercase">Practice</span>
        <h1 className="m-0 font-serif text-[2.25rem] leading-[1.05] font-normal tracking-[-0.01em]">This position isn’t legal</h1>
        <p className="m-0 text-body text-cb-text-soft">
          A practice position needs one king for each side, no pawns on the first or last rank, and the side that just
          moved must not be in check.
        </p>
        <Button
          variant="primary"
          onClick={() => {
            if (window.history.length > 1) router.back();
            else router.push("/play");
          }}
          data-testid="practice-illegal-back"
        >
          Back
        </Button>
      </div>
    </div>
  );
}
