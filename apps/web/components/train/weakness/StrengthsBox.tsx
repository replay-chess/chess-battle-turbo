// StrengthsBox (phase-06 plan §4.6 desktop right column): "What you already do well", the strengths, then the footnote
// ("Updated after every analysed game …", hidden at vh640 like the board's `.hint.tall`). Desktop only: phones and
// iPads show the Strengths tab instead.
import { cn } from "@/lib/utils";
import { DESKTOP_ONLY } from "./classes";
import { copy } from "./copy";
import { StrengthsList } from "./StrengthsList";

export function StrengthsBox({ strengths }: { strengths: readonly string[] }) {
  return (
    <section aria-labelledby="weakness-strengths-h" className={cn("flex flex-col gap-2.5 border border-cb-border bg-cb-surface p-3.5", DESKTOP_ONLY)} data-testid="weakness-strengths-box">
      <h2 id="weakness-strengths-h" className="m-0 text-overline">
        {copy.strengthsTitle}
      </h2>
      <StrengthsList strengths={strengths} />
      <p className="m-0 text-xs text-cb-text-soft vh640:hidden">{copy.footnote}</p>
    </section>
  );
}
