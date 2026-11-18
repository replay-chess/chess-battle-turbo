// WeaknessHeadline (phase-06 plan §4.6 "Headline row", §8.17): the verified headline (serif, max 62ch; the short form
// on phones and iPads, 22 px), the VERIFIED tag (`.ver`: green on white; the headline is a template checked against
// the metrics, never free text) and, while a recompute is pending, the Updating chip. Phones and iPad P also carry the
// short scope label above it (the header row is gone there).
import { Check } from "lucide-react";
import type { WeaknessPayload } from "@repo/contracts/http/weakness";
import { Tag } from "@/components/ui/tag";
import { copy } from "./copy";
import { UpdatingChip } from "./UpdatingChip";

export function WeaknessHeadline({ payload }: { payload: Pick<WeaknessPayload, "headline" | "updating" | "scopeLabelShort"> }) {
  const h = payload.headline;
  if (!h) return null;
  return (
    <div className="flex items-start gap-3.5 [@media(hover:none)_and_(pointer:coarse)_and_(orientation:landscape)_and_(min-width:901px)]:flex-col [@media(hover:none)_and_(pointer:coarse)_and_(orientation:landscape)_and_(min-width:901px)]:gap-2 tabbar:flex-col tabbar:gap-2" data-testid="weakness-headline">
      <span
        className="hidden max-w-full truncate text-overline [@media(hover:none)_and_(pointer:coarse)_and_(orientation:landscape)_and_(min-width:901px)]:block tabbar:block"
        title={payload.scopeLabelShort}
        data-testid="weakness-scope-short"
      >
        {payload.scopeLabelShort}
      </span>
      <p className="m-0 max-w-[62ch] font-serif text-[clamp(1.25rem,2.6vh,1.625rem)]/[1.15] font-normal [@media(hover:none)_and_(pointer:coarse)_and_(orientation:landscape)_and_(min-width:901px)]:text-[22px] tabbar:text-[22px]">
        <span className="[@media(hover:none)_and_(pointer:coarse)_and_(orientation:landscape)_and_(min-width:901px)]:hidden tabbar:hidden">{h.text}</span>
        <span className="hidden [@media(hover:none)_and_(pointer:coarse)_and_(orientation:landscape)_and_(min-width:901px)]:inline tabbar:inline">{h.short}</span>
      </p>
      <span className="flex flex-wrap items-center gap-2">
        <Tag tone="good" icon={<Check strokeWidth={3} />} data-testid="weakness-verified">
          {copy.verified}
        </Tag>
        {payload.updating ? <UpdatingChip newGames={payload.updating.newGames} /> : null}
      </span>
    </div>
  );
}
