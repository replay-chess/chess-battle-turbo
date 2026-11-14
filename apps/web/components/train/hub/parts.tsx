// The Train hub's sections (phase-05 plan §4.2 "Components": StreakWeek, PlanStepList, PlanCta, DueStrip,
// AllTrainingList, ThemeMasteryBars, HubFootnote; DR/V3TrainHub*.dc.html). Presentational: TrainHubView composes them
// from `TrainToday` and the model, the route and the demo feed them.
//
// Every link to a session-creating URL (`/train/bank/session?…`, `/train/puzzles?…`) is `prefetch={false}`: a router
// prefetch must never render a page that creates a session (§5.1).
import Link from "next/link";
import { ArrowRight, BookOpen, Check, Flame, Landmark, Puzzle } from "lucide-react";
import type { DuePreview, LastMove, PlanStep, TrainToday } from "@repo/contracts/http/train";
import { MiniBoard } from "@/components/board/MiniBoard";
import type { Sq } from "@/components/board/types";
import { ProgressBar } from "@/components/ui/progress";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import {
  bankRowSub,
  isSessionCreatingHref,
  puzzlesRowSub,
  stepAccessibleName,
  stepTag,
  streakLines,
  WEEK_LETTERS,
  type HubPlanModel,
} from "./model";

/** `.row` of the boards: a 64 px link row with a hairline under it. */
export const ROW =
  "flex min-h-16 items-center gap-3 border-b border-cb-border px-4 py-1.5 text-cb-text no-underline transition-colors duration-150 last:border-b-0 hover:bg-cb-fill focus-visible:-outline-offset-2 [-webkit-tap-highlight-color:transparent]";
export const CARD = "border border-cb-border bg-cb-surface";
export const H2 = "m-0 font-serif text-[1.625rem]/[1.15] font-normal tracking-[-0.01em] text-cb-text";

export type HubLinkTarget = "bank" | "puzzles" | "step_1" | "step_2" | "thumb";

/** The contract's `LastMove` is two squares (its regex is `^[a-h][1-8]$`): the board's square type. */
export function lastMoveSquares(m: LastMove | null): readonly [Sq, Sq] | null {
  return m as readonly [Sq, Sq] | null;
}

// ── Streak ───────────────────────────────────────────────────────────────────────────────────────────────────────
export function StreakWeek({ streak }: { streak: TrainToday["streak"] }) {
  const lines = streakLines({ streak });
  return (
    <div role="img" aria-label={streak.aria} className="flex items-center gap-3.5" data-testid="train-streak">
      <Flame aria-hidden="true" className="size-5 shrink-0" strokeWidth={2} />
      <span className="flex flex-col">
        <span className="font-medium">{lines.title}</span>
        <span className="font-mono text-xs text-cb-text-soft">{lines.sub}</span>
      </span>
      <span className="flex gap-1.5">
        {streak.week.map((on, i) => (
          <span key={i} className="flex flex-col items-center gap-1">
            <span className={cn("size-3.5 rounded-full border border-cb-accent", on ? "bg-cb-accent" : "bg-transparent")} />
            <span className="font-mono text-2xs text-cb-text-soft">{WEEK_LETTERS[i]}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

// ── Plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const STEP_ICON: Record<PlanStep["kind"], React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  bank: Landmark,
  puzzles: Puzzle,
  lesson: BookOpen,
  review: BookOpen,
  import: ArrowRight,
};

export function PlanStepList({
  steps,
  onFollow,
}: {
  steps: PlanStep[];
  onFollow?: (index: number) => void;
}) {
  return (
    <ol className="m-0 list-none p-0" data-testid="train-plan-steps">
      {steps.map((step, i) => {
        const tag = stepTag(step, i);
        const Icon = STEP_ICON[step.kind];
        return (
          <li key={`${step.kind}-${i}`} className="border-b border-cb-border last:border-b-0">
            <Link
              href={step.href}
              prefetch={isSessionCreatingHref(step.href) ? false : undefined}
              className={cn(ROW, "border-b-0")}
              data-testid={`train-plan-step-${i + 1}`}
              data-status={step.status}
              onClick={() => onFollow?.(i)}
            >
              <span aria-hidden="true" className="w-[22px] shrink-0 font-mono text-cb-text-secondary">
                {i + 1}
              </span>
              <Icon aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.75} />
              {/* The spoken name: "Step 1 of 2, due now: Review 3 mistakes …, Mistake Bank, vs tal_fan_77, about 2 minutes". */}
              <span className="sr-only">{stepAccessibleName(step, i, steps.length)}</span>
              <span aria-hidden="true" className="flex min-w-0 flex-auto flex-col">
                <span className="font-medium">{step.title}</span>
                <span className="text-ui text-cb-text-soft">{step.subtitle}</span>
              </span>
              <Tag aria-hidden="true" tone={tag.tone} icon={tag.tone === "good" ? <Check strokeWidth={3} /> : undefined}>
                {tag.text}
              </Tag>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

export function PlanHeading({ id, plan }: { id: string; plan: HubPlanModel }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 pt-4 pb-2 [@media(max-width:600px)]:px-3.5 [@media(max-width:600px)]:pt-3 [@media(max-width:600px)]:pb-1">
      <h2 id={id} className={H2}>
        {plan.heading}
      </h2>
      <span className={cn("font-mono text-ui", plan.complete ? "text-cb-good" : "text-cb-text-soft")} data-testid="train-plan-progress">
        {plan.progress}
      </span>
    </div>
  );
}

// ── Due strip ────────────────────────────────────────────────────────────────────────────────────────────────────
function DueThumb({ p, onFollow, hideWide }: { p: DuePreview; onFollow?: () => void; hideWide: boolean }) {
  return (
    <Link
      href={`/train/bank/session?card=${encodeURIComponent(p.cardRef)}`}
      prefetch={false}
      onClick={onFollow}
      className={cn(
        CARD,
        "flex min-h-[76px] min-w-0 items-center gap-3 p-2.5 text-cb-text no-underline transition-colors duration-150 hover:bg-cb-fill",
        // The 4th thumbnail is for the iPad landscape 2 × 2 grid only.
        hideWide && "hidden rail:flex tabbar:hidden",
      )}
      data-testid="train-due-thumb"
    >
      <MiniBoard fen={p.fen} orientation={p.orient} size={56} lastMove={lastMoveSquares(p.lastMove)} label={p.label} className="shrink-0" />
      {/* Narrow cards (1152–1280 px, zoom) wrap the theme and the opponent and keep the move number on its own line:
          nothing is cut to an ellipsis (FIX-1 the move number, FIX-2 the opponent; a 30-character handle has no spaces,
          so it may break anywhere). */}
      <span className="flex min-w-0 flex-col">
        <span className="line-clamp-2 text-overline break-words text-cb-text">{p.themeLabel}</span>
        <span className="text-ui text-cb-text-soft [overflow-wrap:anywhere]" data-testid="train-due-thumb-opponent">
          vs {p.opponent}
        </span>
        <span className="text-ui whitespace-nowrap text-cb-text-soft">move {p.moveNo}</span>
      </span>
    </Link>
  );
}

export function DueStrip({
  today,
  mode,
  onFollowThumb,
  onFollowBank,
}: {
  today: TrainToday;
  mode: "thumbs" | "empty_bank" | "nothing_due";
  onFollowThumb?: () => void;
  onFollowBank?: () => void;
}) {
  return (
    <section aria-labelledby="train-due-h" className="flex flex-col gap-2.5" data-testid="train-due-strip" data-mode={mode}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="train-due-h" className="m-0 text-overline">
          Due from your games
        </h2>
        {mode !== "empty_bank" ? (
          <Link href="/train/bank" onClick={onFollowBank} className="inline-flex min-h-11 items-center text-sm text-cb-text underline underline-offset-3 decoration-cb-text/30 hover:decoration-cb-text">
            Open Mistake Bank
          </Link>
        ) : null}
      </div>
      {mode === "thumbs" ? (
        <div className="grid grid-cols-3 gap-2.5 rail:grid-cols-2 tabbar:grid-cols-3">
          {today.due.preview.map((p, i) => (
            <DueThumb key={p.cardRef} p={p} onFollow={onFollowThumb} hideWide={i >= 3} />
          ))}
        </div>
      ) : mode === "empty_bank" ? (
        <div className={cn(CARD, "flex flex-col items-center gap-1.5 px-4 py-5 text-center")} data-testid="train-bank-empty">
          <h3 className="m-0 font-serif text-2xl/[1.1] font-normal tracking-[-0.01em] text-cb-text">Your Bank Is Empty</h3>
          <p className="m-0 text-body text-cb-text-soft">Mistakes from your games land here as puzzles.</p>
        </div>
      ) : (
        <p className={cn(CARD, "m-0 px-4 py-3.5 text-body text-cb-text-soft")} data-testid="train-nothing-due">
          Nothing from your games is due right now.
        </p>
      )}
    </section>
  );
}

// ── All training ─────────────────────────────────────────────────────────────────────────────────────────────────
export function AllTrainingList({ today, onFollow }: { today: TrainToday; onFollow?: (target: "bank" | "puzzles") => void }) {
  return (
    <section aria-labelledby="train-all-h" className={CARD} data-testid="train-all">
      <h2 id="train-all-h" className="m-0 px-4 pt-3.5 pb-1.5 text-overline">
        All training
      </h2>
      <Link href="/train/bank" className={ROW} onClick={() => onFollow?.("bank")} data-testid="train-all-bank">
        <Landmark aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.75} />
        <span className="flex min-w-0 flex-auto flex-col">
          <span className="font-medium">Mistake Bank</span>
          <span className="text-ui text-cb-text-soft">{bankRowSub(today)}</span>
        </span>
        <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
      </Link>
      <Link href="/train/puzzles?pick=1" prefetch={false} className={ROW} onClick={() => onFollow?.("puzzles")} data-testid="train-all-puzzles">
        <Puzzle aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.75} />
        <span className="flex min-w-0 flex-auto flex-col">
          <span className="font-medium">Puzzles by Theme</span>
          <span className="text-ui text-cb-text-soft">{puzzlesRowSub(today)}</span>
        </span>
        <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
      </Link>
    </section>
  );
}

// ── Theme mastery ────────────────────────────────────────────────────────────────────────────────────────────────
export function ThemeMasteryBars({ mastery }: { mastery: TrainToday["mastery"] }) {
  if (!mastery.length) return null;
  return (
    <section aria-labelledby="train-mastery-h" className={cn(CARD, "flex flex-col gap-2.5 px-4 py-3.5")} data-testid="train-mastery">
      <h2 id="train-mastery-h" className="m-0 text-overline">
        Theme mastery
      </h2>
      {mastery.map((m) => (
        <div key={m.key} className="grid grid-cols-[110px_minmax(0,1fr)_40px] items-center gap-2.5 text-sm">
          <span className="truncate">{m.label}</span>
          <ProgressBar value={m.pct} label={`${m.label} mastery`} valueText={`${m.pct}%`} />
          <span className="text-right font-mono">{m.pct}%</span>
        </div>
      ))}
    </section>
  );
}

export function HubFootnote({ text }: { text: string }) {
  return <span className="text-sm text-cb-text-soft">{text}</span>;
}
