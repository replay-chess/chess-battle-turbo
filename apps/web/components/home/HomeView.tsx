"use client";

// Home (phase-05 plan §4.1; boards V3Home `populated | new_user | import_running | payment_failed | trial`,
// V3HomeNewUser). The presentational screen: every state renders from HomeData props, so the live route
// (HomeScreen: TanStack Query + the user room) and the /dev/ui/home demo (fixtures) share it. `payment_failed` and
// `trial` are the shell's (its payment banner and the trial tag); `loading` is HomeSkeleton (loading.tsx).
//
// Links: Start Review is fully prefetched (the likely next click; /review has no write side effects). The bank
// thumbnails and Review 4 · About 3 min open session-creating URLs, so they are never prefetched (plan §5.1). Rows use
// the default intent prefetch of plain links with prefetch={false}.
//
// No chess.js here: boards are server-shaped SVG (StaticBoard for the large one, MiniBoard for thumbnails).

import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import type { HomeBank, HomeContinue, HomeData, HomeImport, HomeRecentGame, HomeStartHere, HomeWeek } from "@repo/contracts/http/home";
import { MiniBoard } from "@/components/board/MiniBoard";
import { StaticBoard } from "@/components/board/StaticBoard";
import type { Sq } from "@/components/board/types";
import { ScrollRegion } from "@/components/layout/ScrollRegion";
import { buttonVariants } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  analysingLine,
  bankCountLabel,
  bankCta,
  bankLine,
  continueBoardLabel,
  continueSentence,
  gamesThisWeekLabel,
  greetingText,
  HOME_COPY,
  HOME_LINKS,
  importLabel,
  importSub,
  RESULT_LABEL,
  recentSub,
  reviewHref,
  thumbHref,
  WEEK_DAYS,
  weekLine,
} from "./copy";
import "./home.css";

/** What a click reports (telemetry lives in HomeScreen; the demo passes nothing). */
export type HomeTrack = {
  continueClicked?: (kind: "review" | "first_legend" | "analysing") => void;
  bankCtaClicked?: (due: number) => void;
  importClicked?: (surface: "start_here" | "recent_empty" | "bank_empty") => void;
};

export type HomeViewProps = {
  data: HomeData;
  /** `/profile/<ref>` (See Profile); `#profile` in the demo. */
  profileHref: string;
  track?: HomeTrack;
};

export function HomeView({ data, profileHref, track = {} }: HomeViewProps) {
  const isNew = data.state === "new_user";
  return (
    <div className="hm-root" data-rc-lock="" data-testid="home" data-state={data.state}>
      <ScrollRegion label="Home" className="hm">
      <header className="hm-head" data-testid="home-header">
        <h1 className="hm-h1" data-testid="home-greeting">
          {greetingText(data)}
        </h1>
        {isNew ? null : (
          <span className="hm-stat hm-wide" data-testid="home-games-week">
            {gamesThisWeekLabel(data.stats.gamesThisWeek)}
          </span>
        )}
        <span className="hm-head__space" />
        <span className="hm-head__actions hm-actions">
          <Link className={cn(buttonVariants({ variant: "secondary" }), "hm-wide")} href={HOME_LINKS.playFriend} prefetch={false}>
            {HOME_COPY.playFriend}
          </Link>
          <Link className={buttonVariants({ variant: "primary" })} href={HOME_LINKS.newGame} prefetch={false} data-testid="home-new-game">
            <Play aria-hidden="true" />
            {HOME_COPY.newGame}
          </Link>
        </span>
      </header>
      {data.import ? <ImportStatusRow imp={data.import} /> : null}
      <div className="hm-grid">
        <div className="hm-main">
          {data.continue ? (
            <ContinueCard c={data.continue} track={track} />
          ) : data.startHere ? (
            <StartHereCard s={data.startHere} showImport={!data.hasLinkedAccount} track={track} />
          ) : null}
          <div className="hm-trio">
            <BankCard bank={data.bank} isNew={isNew} track={track} />
            <WeekCard week={data.week} isNew={isNew} profileHref={profileHref} />
            <PlayCard />
          </div>
        </div>
        <RecentGames games={data.recent} track={track} />
      </div>
      </ScrollRegion>
    </div>
  );
}

export function ImportStatusRow({ imp }: { imp: HomeImport }) {
  const label = importLabel(imp);
  return (
    <div className="hm-import" role="status" data-testid="home-import">
      <span className="hm-import__label" data-testid="home-import-label">
        {label}
      </span>
      {imp.total !== null && imp.total > 0 ? (
        <ProgressBar className="hm-import__bar" value={imp.imported} max={imp.total} label={HOME_COPY.importLabel} unit="games" />
      ) : (
        <span className="hm-import__bar" />
      )}
      <span className="hm-import__sub">{importSub(imp)}</span>
    </div>
  );
}

function ArrowIcon() {
  return <ArrowRight aria-hidden="true" />;
}

export function ContinueCard({ c, track }: { c: HomeContinue; track: HomeTrack }) {
  const analysing = c.kind === "analysing";
  const progressId = `home-cont-progress-${c.gameRef}`;
  return (
    <section className="hm-card hm-cont" aria-labelledby="home-cont-h" data-testid="home-continue" data-kind={c.kind}>
      <div className="hm-board">
        <StaticBoard fen={c.fen} orientation={c.orient} lastMove={c.lastMove as readonly [Sq, Sq] | null} label={continueBoardLabel(c)} data-testid="home-continue-board" />
      </div>
      <div className="hm-cont__body">
        <span className="hm-lbl" id="home-cont-eyebrow">
          {HOME_COPY.continueEyebrow(c.whenLabel)}
        </span>
        <h2 className="hm-h2" id="home-cont-h">
          {c.kind === "clean" ? HOME_COPY.cleanHeading : HOME_COPY.reviewHeading}
        </h2>
        <p className="hm-p" data-testid="home-continue-text">
          {continueSentence(c)}
        </p>
        {analysing ? (
          <div className="hm-progress">
            <span className="hm-lbl" id={progressId} data-testid="home-continue-analysing">
              {analysingLine(c.analysis)}
            </span>
            <ProgressBar value={c.analysis.done} max={Math.max(1, c.analysis.total)} label={HOME_COPY.analysingLabel} />
          </div>
        ) : null}
        <div className="hm-actions">
          {analysing ? (
            <button
              type="button"
              className={buttonVariants({ variant: "primary" })}
              disabled
              aria-describedby={progressId}
              data-testid="home-start-review"
            >
              {HOME_COPY.startReview}
              <ArrowIcon />
            </button>
          ) : (
            <Link
              className={buttonVariants({ variant: "primary" })}
              href={reviewHref(c.gameRef)}
              prefetch
              onClick={() => track.continueClicked?.("review")}
              data-testid="home-start-review"
            >
              {c.kind === "clean" ? HOME_COPY.openReview : HOME_COPY.startReview}
              <ArrowIcon />
            </Link>
          )}
          <span className="hm-actions__note hm-tall">{HOME_COPY.everyGame}</span>
        </div>
      </div>
    </section>
  );
}

export function StartHereCard({ s, showImport, track }: { s: HomeStartHere; showImport: boolean; track: HomeTrack }) {
  return (
    <section className="hm-card hm-cont" aria-labelledby="home-start-h" data-testid="home-start-here">
      <div className="hm-board">
        <StaticBoard fen={s.fen} orientation={s.orient} label={s.ariaLabel} data-testid="home-start-board" />
      </div>
      <div className="hm-cont__body">
        <span className="hm-lbl">{HOME_COPY.startHereEyebrow}</span>
        <h2 className="hm-h2 hm-h2--serif" id="home-start-h">
          {s.title}
        </h2>
        <p className="hm-p">{s.blurb}</p>
        <div className="hm-actions">
          <Link
            className={buttonVariants({ variant: "primary" })}
            href={s.href}
            prefetch={false}
            onClick={() => track.continueClicked?.("first_legend")}
            data-testid="home-start-legend"
          >
            <Play aria-hidden="true" />
            Play the Opera Game
          </Link>
          {showImport ? (
            <Link
              className={buttonVariants({ variant: "secondary" })}
              href={HOME_LINKS.connected}
              prefetch={false}
              onClick={() => track.importClicked?.("start_here")}
              data-testid="home-import-cta"
            >
              {HOME_COPY.importChesscom}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function BankCard({ bank, isNew, track }: { bank: HomeBank; isNew: boolean; track: HomeTrack }) {
  const cta = bankCta(bank, isNew);
  const empty = cta.kind === "how";
  const thumbs = empty ? [] : bank.thumbs.slice(0, bank.due > 0 ? bank.thumbs.length : 0);
  return (
    <section className="hm-card hm-tile hm-bank" aria-labelledby="home-bank-h" data-testid="home-bank">
      <div className="hm-tile__head">
        <h2 className="hm-lbl" id="home-bank-h">
          {HOME_COPY.bankHeading}
        </h2>
        <span className="hm-mono" style={{ fontSize: "0.75rem" }} data-testid="home-bank-due">
          {bankCountLabel(bank.due)}
        </span>
      </div>
      <p className="hm-tile__line" data-testid="home-bank-line">
        {bankLine(bank, isNew)}
      </p>
      {thumbs.length > 0 ? (
        <ul className="hm-minis" aria-label="Positions due for review" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {thumbs.map((t) => (
            <li key={t.cardRef}>
              <Link className="hm-mini" href={thumbHref(t.cardRef)} prefetch={false} aria-label={t.label} data-testid="home-bank-thumb">
                <MiniBoard fen={t.fen} orientation={t.orient} />
              </Link>
            </li>
          ))}
        </ul>
      ) : empty ? (
        <div className="hm-minis" aria-hidden="true">
          <span className="hm-mini-ph" />
          <span className="hm-mini-ph" />
          <span className="hm-mini-ph" />
          <span className="hm-mini-ph" />
        </div>
      ) : null}
      <Link
        className={cn(buttonVariants({ variant: "secondary" }), "hm-tile__cta")}
        href={cta.href}
        prefetch={false}
        onClick={() => (cta.kind === "how" ? undefined : track.bankCtaClicked?.(bank.due))}
        data-testid="home-bank-cta"
        data-kind={cta.kind}
      >
        {cta.label}
      </Link>
    </section>
  );
}

export function WeekCard({ week, isNew, profileHref }: { week: HomeWeek; isNew: boolean; profileHref: string }) {
  return (
    <section className="hm-card hm-tile" aria-labelledby="home-week-h" data-testid="home-week">
      <h2 className="hm-lbl" id="home-week-h">
        {HOME_COPY.weekHeading}
      </h2>
      <p className="hm-tile__mono" data-testid="home-week-line">
        {weekLine(week)}
      </p>
      {isNew ? <p className="hm-tile__line hm-tall">{HOME_COPY.weekNewSub}</p> : null}
      <div className="hm-week" role="img" aria-label={week.aria} data-testid="home-week-dots">
        {WEEK_DAYS.map((d, i) => (
          <span key={i} aria-hidden="true">
            {d}
            <span className="hm-dot" data-on={week.days[i] ? "" : undefined} />
          </span>
        ))}
      </div>
      <Link className="hm-link" href={profileHref} prefetch={false}>
        {HOME_COPY.seeProfile}
      </Link>
    </section>
  );
}

export function PlayCard() {
  const btn = cn(buttonVariants({ variant: "secondary" }), "w-full");
  return (
    <section className="hm-card hm-tile hm-play hm-tall" aria-labelledby="home-play-h" data-testid="home-play">
      <h2 className="hm-lbl" id="home-play-h">
        {HOME_COPY.playHeading}
      </h2>
      <Link className={btn} href={HOME_LINKS.quickMatch} prefetch={false}>
        <Play aria-hidden="true" />
        {HOME_COPY.quickMatch}
      </Link>
      <Link className={btn} href={HOME_LINKS.playFriend} prefetch={false}>
        {HOME_COPY.challengeFriend}
      </Link>
      <Link className={btn} href={HOME_LINKS.playBot} prefetch={false}>
        {HOME_COPY.playBot}
      </Link>
    </section>
  );
}

export function RecentGames({ games, track }: { games: readonly HomeRecentGame[]; track: HomeTrack }) {
  return (
    <section className="hm-card hm-recent" aria-labelledby="home-recent-h" data-testid="home-recent">
      <div className="hm-recent__head">
        <h2 className="hm-lbl" id="home-recent-h">
          {HOME_COPY.recentHeading}
        </h2>
        {games.length > 0 ? (
          <Link className="hm-link" href={HOME_LINKS.games} prefetch={false}>
            {HOME_COPY.allGames}
          </Link>
        ) : null}
      </div>
      {games.length > 0 ? (
        <ScrollRegion label={HOME_COPY.recentList} className="hm-recent__list">
          <ul className="hm-recent__ul">
          {games.map((g) => (
            <li key={g.gameRef}>
              <Link className="hm-row" href={reviewHref(g.gameRef)} prefetch={false} data-testid="home-recent-row">
                <span className="hm-pill" data-result={g.result}>
                  {RESULT_LABEL[g.result]}
                </span>
                <span className="hm-row__text">
                  <span className="hm-row__opp">
                    {g.opponent}
                    {g.opponentRating === null ? null : <span className="hm-mono hm-soft" style={{ fontSize: "0.75rem" }}>{` (${g.opponentRating})`}</span>}
                  </span>
                  <span className="hm-row__sub">{recentSub(g)}</span>
                </span>
              </Link>
            </li>
          ))}
          </ul>
        </ScrollRegion>
      ) : (
        <div className="hm-recent__empty" data-testid="home-recent-empty">
          <div className="hm-ghosts" aria-hidden="true">
            <span>
              <i />
              <i />
              <i />
            </span>
            <span>
              <i />
              <i />
              <i />
            </span>
          </div>
          <p style={{ margin: 0, fontSize: "0.875rem" }}>{HOME_COPY.recentEmpty}</p>
          <Link className="hm-link" style={{ marginTop: 0 }} href={HOME_LINKS.connected} prefetch={false} onClick={() => track.importClicked?.("recent_empty")}>
            {HOME_COPY.importAny}
          </Link>
        </div>
      )}
    </section>
  );
}
