// The Mistake Bank's two whole-page states (phase-05 plan §4.3; DR/V3BankEmpty, V3BankCaughtUp and the device `empty`
// / `caughtup` boards): `EmptyBank` (no cards yet: how the bank fills, with the example card) and `CaughtUp` (cards,
// none due: the next batch, Coming up, the caught-up CTAs). Server-compatible markup; the copy is data-driven.
import Link from "next/link";
import { ArrowRight, BookOpen, Check, Download, Landmark } from "lucide-react";
import type { BankPage } from "@repo/contracts/http/train";
import { MiniBoard } from "@/components/board/MiniBoard";
import { buttonVariants } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { CARD } from "../hub/parts";
import { MasteryDots } from "./BankRow";
import { EXAMPLE_FEN, type CaughtUpModel } from "./model";

const H2 = "m-0 font-serif text-[clamp(2rem,4.4vh,2.75rem)]/[1.05] font-normal tracking-[-0.01em] text-balance text-cb-text tabbar:text-[1.625rem]/[1.15]";
const LINK_ROW =
  "flex min-h-[52px] items-center gap-3 border-b border-cb-border px-3.5 py-1.5 text-cb-text no-underline transition-colors duration-150 hover:bg-cb-fill focus-visible:-outline-offset-2";
/** The two-column frame of both states (max 1080, centred); one column in tab-bar mode. */
const FRAME =
  "mx-auto grid w-full max-w-[1080px] grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-10 tabbar:grid-cols-[minmax(0,1fr)] tabbar:items-start tabbar:gap-5";

export function EmptyBank({ page }: { page: BankPage }) {
  const ctas = page.emptyCtas;
  return (
    <section className={FRAME} aria-labelledby="bank-empty-h" data-testid="bank-empty">
      <div className="flex flex-col gap-4 tabbar:order-2 tabbar:gap-3">
        <p className="m-0 text-overline tabbar:hidden">Empty bank</p>
        <h2 id="bank-empty-h" className={H2}>
          Your mistakes will land here after you review a game
        </h2>
        <p className="m-0 max-w-[46ch] text-base text-cb-text/70">
          Every review adds the moments where a better move was there. Each one comes back on a schedule until you find it every time.
        </p>
        <div className="flex max-w-[460px] flex-col">
          <Link href="/play" className={cn(buttonVariants({ size: "lg" }), "tabbar:hidden")} data-testid="bank-empty-play">
            Play a Game to Fill Your Bank
          </Link>
          {ctas?.lastGame ? (
            <Link href={`/review/${encodeURIComponent(ctas.lastGame.gameRef)}`} className={cn(LINK_ROW, "tabbar:border-t")} data-testid="bank-empty-review">
              <BookOpen aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.75} />
              <span className="flex-auto">
                Review Your Last Game
                <span className="block text-ui text-cb-text-soft">
                  vs {ctas.lastGame.opponent} · {ctas.lastGame.reviewed ? "reviewed" : "not reviewed yet"}
                </span>
              </span>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
            </Link>
          ) : null}
          {ctas && !ctas.hasLinkedAccount ? (
            <Link href="/settings/connected" className={cn(LINK_ROW, "border-b-0")} data-testid="bank-empty-import">
              <Download aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.75} />
              <span className="flex-auto">
                Import Games From Chess.com or Lichess
                <span className="block text-ui text-cb-text-soft">We find mistakes in your last 100 games</span>
              </span>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
            </Link>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-2.5 tabbar:order-1">
        <p className="m-0 text-overline tabbar:hidden">What a bank card looks like</p>
        {/* The design fades the whole card (opacity .55); here the board and border fade and the text stays legible. */}
        <div aria-hidden="true" className={cn(CARD, "grid grid-cols-[120px_minmax(0,1fr)] gap-3.5 border-dashed border-cb-border-dashed p-3.5 tabbar:grid-cols-[72px_minmax(0,1fr)] tabbar:p-3")}>
          <MiniBoard fen={EXAMPLE_FEN} size={120} className="size-[120px] opacity-55 tabbar:size-[72px]" />
          <span className="flex flex-col gap-2 text-cb-text-soft">
            <Tag className="self-start">Example</Tag>
            <span>Loose piece · vs your opponent · move 19</span>
            <span className="text-sm tabbar:hidden">You played Qd2 · best was Rxf5</span>
            <span className="tabbar:hidden">
              <MasteryDots mastery={0} size={8} />
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}

export function CaughtUp({
  page,
  model,
  browseHref,
  onBrowse,
}: {
  page: BankPage;
  model: CaughtUpModel;
  browseHref: string;
  onBrowse?: () => void;
}) {
  const focus = page.focusTheme;
  return (
    <section className={FRAME} aria-labelledby="bank-caughtup-h" data-testid="bank-caughtup">
      <div className="flex flex-col items-start gap-4 tabbar:gap-3">
        <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-full border border-cb-good/50 text-cb-good tabbar:size-[52px]">
          <Check className="size-6" />
        </span>
        <h2 id="bank-caughtup-h" className={H2}>
          {model.title}
        </h2>
        <p className="m-0 text-base text-cb-text/70" data-testid="bank-caughtup-line">
          {model.body}
        </p>
        <div className="flex w-full max-w-[460px] flex-col">
          <Link
            href={`/train/puzzles?theme=${encodeURIComponent(focus.key)}&source=bank`}
            prefetch={false}
            className={cn(buttonVariants({ size: "lg" }), "tabbar:hidden")}
            data-testid="bank-caughtup-puzzles"
          >
            Train {focus.label} While You Wait
          </Link>
          <Link
            href={browseHref}
            onClick={(e) => {
              // The bank's filters are page state (replaceState), not a navigation: a soft navigation to `?view=all`
              // left the caught-up page on screen (regression: bank-browse-all-noop, WP-I D-I2).
              if (!onBrowse) return;
              e.preventDefault();
              onBrowse();
            }}
            className={cn(LINK_ROW, "border-b-0")}
            data-testid="bank-caughtup-browse"
          >
            <Landmark aria-hidden="true" className="size-5 shrink-0" strokeWidth={1.75} />
            <span className="flex-auto">{model.browseLabel}</span>
            <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
          </Link>
        </div>
      </div>
      {page.upcoming.length ? (
        <div className={cn(CARD, "flex flex-col gap-3 p-4 tabbar:hidden")} data-testid="bank-upcoming">
          <h3 className="m-0 text-overline">Coming up</h3>
          <ul className="m-0 flex list-none flex-col p-0">
            {page.upcoming.map((u) => (
              <li key={u.label} className="grid min-h-8 grid-cols-[110px_minmax(0,1fr)_30px] items-center gap-2.5 text-sm">
                <span>{u.label}</span>
                <span aria-hidden="true" className="h-1.5 bg-cb-text/6">
                  <span className="block h-1.5 bg-cb-accent" style={{ width: `${Math.round((u.n / model.upcomingMax) * 100)}%` }} />
                </span>
                <span className="text-right font-mono">{u.n}</span>
              </li>
            ))}
          </ul>
          <p className="m-0 text-ui text-cb-text-soft">{`Scheduled with FSRS. You never get more than ${model.cap} a day.`}</p>
        </div>
      ) : null}
    </section>
  );
}
