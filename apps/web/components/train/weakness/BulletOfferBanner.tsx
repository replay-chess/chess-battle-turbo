// BulletOfferBanner (phase-06 plan §4.4 `bullet_offer`): an info banner above the grid, "You have 64 bullet games from
// the last 6 months. Include them?" with "Include bullet games" (TR-12 `{timeClasses: [BULLET, BLITZ, RAPID]}`). The
// banner is `role=status`; a 429 shows the countdown under it.
import type { RetryCountdownState } from "@/components/system/useRetryCountdown";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { copy } from "./copy";
import { RateLimitedInline } from "./RateLimitedInline";

export function BulletOfferBanner({ text, onInclude, pending, limit }: { text: string; onInclude: () => void; pending: boolean; limit?: RetryCountdownState }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Banner
        tone="info"
        data-testid="weakness-bullet-offer"
        action={
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            onClick={() => {
              if (!limit?.limited) onInclude();
            }}
            className="min-h-11"
            data-testid="weakness-include-bullet"
            {...(limit?.controlProps ?? {})}
          >
            {copy.bulletCta}
          </Button>
        }
      >
        {text}
      </Banner>
      {limit ? <RateLimitedInline countdown={limit} lead={copy.rebuildLimited} /> : null}
    </div>
  );
}
