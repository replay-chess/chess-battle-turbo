// ProfileProgress (phase-06 plan §4.5 steps, §8.13): the `ol` of the 4 build steps — Import {n} games, Grade every move
// with Stockfish, Find patterns across games, Compare with players rated {band} — each with its state icon (done ✓,
// running spinner, waiting ring), the label and a 4 px bar. The state is also text (sr-only), never only an icon.
import type { WeaknessProgress } from "@repo/contracts/http/weakness";
import { Check } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { copy } from "./copy";

const STATE_TEXT = { done: copy.stepDone, run: copy.stepRunning, wait: copy.stepWaiting } as const;

export function ProfileProgress({ steps, stalled }: { steps: WeaknessProgress["steps"]; stalled: boolean }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-1 p-0" data-testid="weakness-steps">
      {steps.map((s) => (
        <li
          key={s.key}
          className="grid min-h-14 grid-cols-[24px_minmax(0,1fr)_120px] items-center gap-3 border border-cb-border bg-cb-surface px-4 py-3 tabbar:grid-cols-[24px_minmax(0,1fr)_72px]"
          data-step={s.key}
          data-state={s.state}
        >
          <span aria-hidden="true" className="inline-flex">
            {s.state === "done" ? (
              <Check className="size-[18px] text-cb-good" />
            ) : s.state === "run" && !stalled ? (
              <Spinner />
            ) : (
              <span className="block size-3 rounded-full border border-cb-text/30" />
            )}
          </span>
          <span className="min-w-0">
            {s.label}
            <span className="sr-only">, {STATE_TEXT[s.state]}</span>
          </span>
          <span aria-hidden="true" className="relative block h-1 overflow-hidden bg-cb-border">
            <span className="absolute inset-y-0 left-0 bg-cb-accent transition-[width] duration-200 ease-linear motion-reduce:transition-none" style={{ width: `${s.pct}%` }} />
          </span>
        </li>
      ))}
    </ol>
  );
}
