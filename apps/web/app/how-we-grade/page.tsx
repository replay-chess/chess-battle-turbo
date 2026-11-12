// How we grade (phase-03 plan §4.5, §5.6; DR/V3HowWeGrade.dc.html). Public and static: every number comes from the
// grader's own constants (content.ts), so the page changes only when the grading does (a deploy). One viewport: the
// marketing top nav, the left column (title, lead, tabs, engine line) and the tab panel, which is the only part that
// scrolls; a one-line footer. Tabs: Move Labels and Accuracy (the Verified Coach tab arrives with P7's `coach` flag).
import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/shell/Brand";
import { createMetadata } from "@/lib/seo";
import {
  ATTRIBUTION,
  FAILURES_ANCHOR,
  accuracyFormula,
  accuracyFormulaInWords,
  engineLine,
  failureParagraphs,
  gameAccuracyText,
  labelRows,
  winFormula,
  winFormulaNote,
} from "./content";
import { GradeBadge } from "./GradeBadge";
import { HowWeGradeTabs } from "./HowWeGradeTabs";
import { NavAuth } from "./NavAuth";

export const dynamic = "force-static";

export const metadata: Metadata = createMetadata({
  title: "How We Grade Your Chess Moves",
  description:
    "The formulas behind every move label and accuracy score on Replay Chess: win% from the engine’s evaluation, the 12 move labels and their thresholds, and the accuracy formula.",
  path: "/how-we-grade",
});

const NAV = [
  { href: "/", label: "Coaching", wide: true },
  { href: "/legends", label: "Learn", wide: true },
  { href: "/blog", label: "Blog", wide: true },
  { href: "/pricing", label: "Pricing", wide: false },
] as const;

const FOOT = [
  { href: "/about", label: "About" },
  { href: "/help", label: "Help" },
  { href: "/contact", label: "Contact" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
] as const;

function TopNav() {
  return (
    <header
      className="flex h-16 shrink-0 items-center gap-7 border-b border-cb-border bg-cb-bg/85 px-8 narrow:gap-4.5 narrow:px-5 vh640:h-12 tabbar:gap-3 tabbar:px-4"
      data-testid="hwg-nav"
    >
      <Brand href="/" logoClassName="size-9 vh640:size-7" wordmarkClassName="[@media(max-width:600px)]:hidden" />
      <nav aria-label="Main" className="flex gap-5.5 narrow:gap-3.5">
        {NAV.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={
              l.wide
                ? "inline-flex min-h-11 items-center font-mono text-label font-medium tracking-[0.12em] text-cb-text-soft uppercase no-underline hover:text-cb-text [@media(max-width:600px)]:hidden"
                : "inline-flex min-h-11 items-center font-mono text-label font-medium tracking-[0.12em] text-cb-text-soft uppercase no-underline hover:text-cb-text"
            }
            data-testid={`hwg-nav-${l.label.toLowerCase()}`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <NavAuth />
    </header>
  );
}

function LabelsPanel() {
  return (
    <>
      <p className="m-0 max-w-[720px] text-body text-cb-text">
        Each move is graded by how much it changes your chance of winning (win%), from your side, before and after the
        move. Win% comes from the engine’s score using the formula Lichess publishes. Colour is never the only
        signal: every badge carries a symbol.
      </p>
      <ul
        className="m-0 grid flex-[1_0_auto] list-none auto-rows-[minmax(0,1fr)] grid-cols-3 gap-px border border-cb-border bg-cb-border p-0 narrow:grid-cols-2 [@media(max-width:600px)]:flex-none [@media(max-width:600px)]:auto-rows-auto [@media(max-width:600px)]:grid-cols-1"
        data-testid="hwg-labels"
      >
        {labelRows().map((row) => (
          <li
            key={row.key}
            id={row.key}
            className="grid scroll-mt-3 grid-cols-[28px_minmax(0,1fr)] content-center items-start gap-3 bg-cb-surface px-4.5 py-4 vh700:px-3.5 vh700:py-2.5"
            data-label={row.key}
          >
            <GradeBadge kind={row.key} />
            <span className="flex flex-col gap-0.5 leading-[1.4]">
              <span className="text-base font-medium text-cb-text">{row.name}</span>
              <span className="text-sm text-cb-text-soft">{row.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function AccuracyPanel() {
  return (
    <>
      <h2 id="accuracy" className="m-0 text-lg font-medium text-cb-text">
        Accuracy
      </h2>
      <p className="m-0 max-w-[720px] text-body text-cb-text">
        Accuracy is the average of a per-move score from 0 to 100, where each move’s score falls as its win% loss
        grows. A game of only best moves scores 100.
      </p>
      <div className="flex max-w-[720px] flex-col gap-2 border border-cb-border bg-cb-surface p-4" data-testid="hwg-formula">
        <span className="text-overline">Per-move score</span>
        <span className="font-mono text-[0.9375rem] text-cb-text" data-testid="hwg-formula-accuracy">
          {accuracyFormula()}
        </span>
        <span className="text-xs leading-[1.4] text-cb-text-soft">
          Clamped to 0–100. The formula Lichess publishes, including its +1.
        </span>
        <p className="m-0 text-sm text-cb-text-soft">{accuracyFormulaInWords()}</p>
      </div>
      <div className="flex max-w-[720px] flex-col gap-2 border border-cb-border bg-cb-surface p-4" id="win-percent">
        <span className="text-overline">Win%</span>
        <span className="font-mono text-[0.9375rem] text-cb-text" data-testid="hwg-formula-win">
          {winFormula()}
        </span>
        <span className="text-xs leading-[1.4] text-cb-text-soft">{winFormulaNote()}</span>
      </div>
      <p className="m-0 max-w-[720px] text-body text-cb-text">{gameAccuracyText()}</p>
      <p className="m-0 max-w-[720px] text-body text-cb-text-soft">
        We show accuracy as a whole number with no decimals, and only after the game.
      </p>
      <section aria-labelledby={`${FAILURES_ANCHOR}-h`} className="flex max-w-[720px] flex-col gap-2 pt-2" id={FAILURES_ANCHOR}>
        <h2 id={`${FAILURES_ANCHOR}-h`} className="m-0 scroll-mt-3 text-lg font-medium text-cb-text">
          Why analysis sometimes stops
        </h2>
        {failureParagraphs().map((p) => (
          <p key={p.slice(0, 24)} className="m-0 text-body text-cb-text">
            {p}
          </p>
        ))}
      </section>
    </>
  );
}

export default function HowWeGradePage() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-cb-bg text-cb-text" data-testid="hwg-page">
      <TopNav />
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        <HowWeGradeTabs
          intro={
            <>
              <h1 className="m-0 font-serif text-[2.5rem]/none font-normal tracking-[-0.01em] text-cb-text tabbar:text-[2rem]/none">
                How we grade
              </h1>
              <p className="m-0 text-body text-cb-text-soft">
                The formulas behind every badge, accuracy score and coach sentence, published so you can check them.
              </p>
            </>
          }
          footnote={
            <div className="flex flex-col gap-1.5 text-xs leading-[1.4] text-cb-text-soft" data-testid="hwg-engine">
              <p className="m-0">{engineLine()}</p>
              <p className="m-0">{ATTRIBUTION}</p>
            </div>
          }
          panels={{ labels: <LabelsPanel />, acc: <AccuracyPanel /> }}
        />
      </main>
      <footer className="flex h-10 shrink-0 items-center gap-4.5 border-t border-cb-border px-8 text-xs text-cb-text-soft vh700:hidden tabbar:hidden">
        <span className="font-mono">ReplayChess</span>
        <span className="flex-auto" />
        {FOOT.map((l) => (
          <Link key={l.href} href={l.href} className="text-cb-text-soft hover:text-cb-text">
            {l.label}
          </Link>
        ))}
      </footer>
    </div>
  );
}
