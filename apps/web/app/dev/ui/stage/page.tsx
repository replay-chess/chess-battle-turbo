import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpDown, ChevronLeft, ChevronRight, Ellipsis, SlidersHorizontal } from "lucide-react";
import ChessBoard from "@/app/components/ChessBoard";
import { BoardStage } from "@/components/layout/BoardStage";
import { ScrollRegion } from "@/components/layout/ScrollRegion";
import { ViewportStage } from "@/components/layout/ViewportStage";
import { AppShellView } from "@/components/shell/AppShellView";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { DebugReadout } from "./DebugReadout";
import { DemoPlayerBar } from "./DemoPlayerBar";
import {
  ANNOTATIONS,
  ARROWS,
  LAST_MOVE,
  STAGE_LAYOUTS,
  listRows,
  middlegameBoard,
  moveRows,
  players,
  stageUser,
  startBoard,
  type StageLayout,
} from "./demo-data";

export const metadata: Metadata = { title: "Stage Demo", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * `/dev/ui/stage` (SPEC 3.9, 10.4): AppShellView + BoardStage + ChessBoard fill,
 * in lock mode. Params: layout=game|hub|list|empty, banner=payment|offline,
 * chrome=shell|none, flip=1, debug=1, stress=1 (long names, long lists).
 */
export default async function StagePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const layoutParam = one(params.layout);
  const layout: StageLayout = STAGE_LAYOUTS.includes(layoutParam as StageLayout) ? (layoutParam as StageLayout) : "game";
  const bannerParam = one(params.banner);
  const chrome = one(params.chrome) === "none" ? "none" : "shell";
  const flip = one(params.flip) === "1";
  const debug = one(params.debug) === "1";
  const stress = one(params.stress) === "1";

  const banner =
    bannerParam === "offline" ? <Banner tone="warn">You are offline. Cached pages still work.</Banner> : undefined;

  const page = (
    <>
      {layout === "game" ? <GameLayout flip={flip} stress={stress} /> : null}
      {layout === "hub" ? <HubLayout flip={flip} stress={stress} /> : null}
      {layout === "list" ? <ListLayout stress={stress} /> : null}
      {layout === "empty" ? <EmptyLayout /> : null}
      {debug ? <DebugReadout /> : null}
    </>
  );

  if (chrome === "none") {
    return <ViewportStage banner={banner}>{page}</ViewportStage>;
  }

  return (
    <AppShellView
      user={stageUser({ payment: bannerParam === "payment", stress })}
      demo
      hideTabBar={layout === "game"}
      banner={banner}
    >
      {page}
    </AppShellView>
  );
}

function GameLayout({ flip, stress }: { flip: boolean; stress: boolean }) {
  const p = players(stress);
  const rows = moveRows(stress ? 300 : 120);
  return (
    <BoardStage
      label="Board"
      top={<DemoPlayerBar player={p.top} />}
      bottom={<DemoPlayerBar player={p.bottom} active />}
      board={
        <ChessBoard
          squareSize="fill"
          board={middlegameBoard()}
          playerColor={flip ? "b" : "w"}
          lastMove={LAST_MOVE}
          arrows={ARROWS}
          annotations={ANNOTATIONS}
          isInteractive={false}
        />
      }
      aside={
        <div className="flex min-h-0 flex-1 flex-col border border-cb-border bg-cb-surface">
          <div data-rc-side-only="" className="flex h-11 shrink-0 items-center border-b border-cb-border px-4">
            <h2 className="text-overline">Moves</h2>
          </div>
          <ScrollRegion label="Moves" className="flex min-h-0 flex-1 flex-col-reverse">
            <ol className="flex flex-col py-1">
              {rows.map((row, i) => {
                const last = i === rows.length - 1;
                return (
                  <li key={row.n} className="grid grid-cols-[2.75rem_minmax(0,1fr)_minmax(0,1fr)] items-center px-2">
                    <span className="font-mono text-label tabular-nums text-cb-text-soft">{row.n}.</span>
                    <MoveButton san={row.white} current={last && row.black == null} />
                    {row.black ? <MoveButton san={row.black} current={last} /> : <span />}
                  </li>
                );
              })}
            </ol>
          </ScrollRegion>
          <div data-rc-side-only="" className="flex shrink-0 gap-2 border-t border-cb-border p-3">
            <Button variant="control" className="flex-1">
              Offer Draw
            </Button>
            <Button variant="control" className="flex-1">
              Resign
            </Button>
          </div>
        </div>
      }
      footer={
        <div className="flex flex-1 items-center justify-around border-t border-cb-border bg-cb-surface">
          <IconButton variant="ghost" label="Previous" icon={<ChevronLeft aria-hidden="true" />} />
          <IconButton variant="ghost" label="Next" icon={<ChevronRight aria-hidden="true" />} />
          <IconButton variant="ghost" label="Flip Board" icon={<ArrowUpDown aria-hidden="true" />} />
          <IconButton variant="ghost" label="More" icon={<Ellipsis aria-hidden="true" />} />
        </div>
      }
    />
  );
}

function MoveButton({ san, current }: { san: string; current: boolean }) {
  return (
    <button
      type="button"
      aria-current={current ? "step" : undefined}
      className="h-8 min-w-0 truncate px-2 text-left font-mono text-ui text-cb-text hover:bg-cb-fill aria-[current=step]:bg-cb-fill aria-[current=step]:font-medium"
    >
      {san}
    </button>
  );
}

const TIME_CONTROLS = ["Bullet", "Blitz", "Rapid", "Classical"] as const;

function HubLayout({ flip, stress }: { flip: boolean; stress: boolean }) {
  const p = players(stress);
  return (
    <BoardStage
      label="Board"
      asideWidth="hub"
      top={<DemoPlayerBar player={p.top} />}
      bottom={<DemoPlayerBar player={p.bottom} />}
      board={<ChessBoard squareSize="fill" board={startBoard()} playerColor={flip ? "b" : "w"} isInteractive={false} />}
      aside={
        <form aria-label="New Game" className="flex min-h-0 flex-1 flex-col border border-cb-border bg-cb-surface">
          <ScrollRegion label="Game Settings" className="flex min-h-0 flex-1 flex-col gap-5 p-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-overline">Time Control</legend>
              <div className="flex">
                {TIME_CONTROLS.map((tc, i) => (
                  <label
                    key={tc}
                    className="relative -ml-px flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center border border-cb-border-strong bg-cb-surface px-2 text-ui text-cb-text first:ml-0 has-checked:z-[1] has-checked:border-cb-accent has-checked:bg-cb-accent has-checked:text-cb-accent-fg has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-cb-text"
                  >
                    <input
                      type="radio"
                      name="time-control"
                      value={tc.toLowerCase()}
                      defaultChecked={i === 1}
                      className="absolute inset-0 m-0 cursor-pointer appearance-none opacity-0"
                    />
                    <span className="truncate">{tc}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-col gap-2">
              <label htmlFor="stage-play-as" className="text-overline">
                Play As
              </label>
              {/* The kit Select: `appearance-none` is what lets WebKit honour the 44px height. */}
              <Select id="stage-play-as" name="play-as" defaultValue="random">
                <option value="white">White</option>
                <option value="black">Black</option>
                <option value="random">Random</option>
              </Select>
            </div>
          </ScrollRegion>
          <div className="shrink-0 border-t border-cb-border p-4">
            <Button size="lg" block>
              Start Game
            </Button>
          </div>
        </form>
      }
    />
  );
}

function ListLayout({ stress }: { stress: boolean }) {
  const rows = listRows(stress ? 200 : 80, stress);
  return (
    <div data-rc-lock="" className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <div className="flex min-w-0 items-center justify-between gap-4 border-b border-cb-border px-4 py-3 sm:px-6">
        <h1 className="min-w-0 truncate font-serif text-heading">Mistake Bank</h1>
        <Button variant="secondary" iconStart={<SlidersHorizontal aria-hidden="true" />}>
          Filter
        </Button>
      </div>
      <ScrollRegion label="Positions" className="min-h-0">
        <ul>
          {rows.map((row) => (
            <li key={row.id} className="flex h-14 min-w-0 items-center gap-3 border-b border-cb-border px-4 sm:px-6">
              <span className="min-w-0 flex-1 truncate text-ui text-cb-text">{row.title}</span>
              <span className="shrink-0 font-mono text-label text-cb-text-soft">{row.meta}</span>
            </li>
          ))}
        </ul>
      </ScrollRegion>
    </div>
  );
}

function EmptyLayout() {
  return (
    <div data-rc-lock="" className="grid min-h-0">
      <ScrollRegion label="Mistake Bank" className="flex min-h-0 flex-col p-6">
        <EmptyState
          className="m-auto max-w-md"
          title="Your Bank Is Empty"
          body="Positions you get wrong in games and lessons land here, ready to replay."
          primary={
            <Button asChild>
              <Link href="/dev/ui/stage?layout=game">Play a Game</Link>
            </Button>
          }
        />
      </ScrollRegion>
    </div>
  );
}
