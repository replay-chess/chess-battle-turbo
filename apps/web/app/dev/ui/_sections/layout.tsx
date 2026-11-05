// Gallery section "Layout" (SPEC 10.5). P5 owns this file.
import Link from "next/link";
import ChessBoard from "@/app/components/ChessBoard";
import { BoardStage } from "@/components/layout/BoardStage";
import { ScrollRegion } from "@/components/layout/ScrollRegion";
import { Button } from "@/components/ui/button";
import { GallerySection, Specimen } from "../_components/Specimen";
import { DemoPlayerBar } from "../stage/DemoPlayerBar";
import { ANNOTATIONS, LAST_MOVE, STAGE_LAYOUTS, middlegameBoard, moveRows, players } from "../stage/demo-data";

const FILL_WIDTHS = [220, 320, 480] as const;
const WIDTH_CLASS: Record<(typeof FILL_WIDTHS)[number], string> = {
  220: "w-[220px]",
  320: "w-[320px]",
  480: "w-[480px]",
};

const LAYOUT_TITLES: Record<(typeof STAGE_LAYOUTS)[number], string> = {
  game: "Game",
  hub: "Hub",
  list: "List",
  empty: "Empty",
};

export function LayoutSection() {
  const p = players(false);
  const scrollRows = Array.from({ length: 40 }, (_, i) => i + 1);
  return (
    <GallerySection id="layout" title="Layout">
      {FILL_WIDTHS.map((w) => (
        <Specimen
          key={w}
          title={`ChessBoard Fill · ${w}px`}
          testId={`ui-chessboard-fill-${w}`}
          note={'squareSize="fill": the board takes its parent\'s width; decorations scale with the board.'}
        >
          <div className={`${WIDTH_CLASS[w]} max-w-full`}>
            <ChessBoard
              squareSize="fill"
              board={middlegameBoard()}
              lastMove={LAST_MOVE}
              annotations={ANNOTATIONS}
              isInteractive={false}
            />
          </div>
        </Specimen>
      ))}

      <Specimen title="Scroll Region" testId="ui-scroll-region" note="The only element allowed to scroll; keyboard-reachable.">
        <div className="grid h-[240px] w-full max-w-sm border border-cb-border">
          <ScrollRegion label="Example Rows" className="min-h-0">
            <ul>
              {scrollRows.map((n) => (
                <li key={n} className="flex h-10 items-center border-b border-cb-border px-3 text-ui">
                  Row {n}
                </li>
              ))}
            </ul>
          </ScrollRegion>
        </div>
      </Specimen>

      <Specimen
        title="Board Stage · 640×400"
        testId="ui-board-stage-mini"
        note="Container sizing inside a non-viewport parent: the board fits the box, not the window."
      >
        <div className="grid h-[400px] w-[640px] max-w-full border border-cb-border-strong">
          <BoardStage
            label="Mini Board"
            top={<DemoPlayerBar player={p.top} />}
            bottom={<DemoPlayerBar player={p.bottom} active />}
            board={<ChessBoard squareSize="fill" board={middlegameBoard()} isInteractive={false} />}
            aside={
              <div className="flex min-h-0 flex-1 flex-col border border-cb-border bg-cb-surface">
                <ScrollRegion label="Mini Moves" className="min-h-0 flex-1">
                  <ol className="flex flex-col py-1">
                    {moveRows(40).map((row) => (
                      <li key={row.n} className="grid h-8 grid-cols-[2.75rem_1fr_1fr] items-center px-2 font-mono text-ui">
                        <span className="text-label text-cb-text-soft">{row.n}.</span>
                        <span>{row.white}</span>
                        <span>{row.black}</span>
                      </li>
                    ))}
                  </ol>
                </ScrollRegion>
              </div>
            }
          />
        </div>
      </Specimen>

      <Specimen title="Stage Demo" testId="ui-stage-links">
        {STAGE_LAYOUTS.map((l) => (
          <Button key={l} asChild variant="secondary">
            <Link href={`/dev/ui/stage?layout=${l}`}>{`Open Stage Demo: ${LAYOUT_TITLES[l]}`}</Link>
          </Button>
        ))}
      </Specimen>
    </GallerySection>
  );
}
