// Route loading for /game/[ref] (plan 4.7; V3Skeletons game variant): BoardStage with skeleton bars, an 8×8 neutral
// grid without pieces and a skeleton panel. The board size is CSS-only, so the real screen replaces it without a
// layout shift.
import { BoardStage } from "@/components/layout/BoardStage";
import "@/features/game/screen/game.css";

function BarSkeleton({ pos }: { pos: "top" | "bottom" }) {
  return (
    <div className="g-pchip" data-pos={pos} aria-hidden="true">
      <span className="g-sk" style={{ width: 32, height: 32, flex: "none" }} />
      <span style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="g-sk" style={{ height: 10, width: "40%" }} />
        <span className="g-sk" style={{ height: 8, width: "25%" }} />
      </span>
      <span className="g-sk" style={{ width: 80, height: 30, flex: "none" }} />
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div
      aria-hidden="true"
      style={{ width: "100%", height: "100%", display: "grid", gridTemplate: "repeat(8, 1fr) / repeat(8, 1fr)" }}
    >
      {Array.from({ length: 64 }, (_, i) => (
        <span
          key={i}
          style={{ background: (Math.floor(i / 8) + i) % 2 === 0 ? "var(--cb-fill)" : "var(--cb-border-strong)" }}
        />
      ))}
    </div>
  );
}

export default function GameLoading() {
  return (
    <div data-rc-game="" style={{ display: "contents" }} aria-busy="true" aria-label="Loading game">
      <BoardStage
        label="Board"
        top={<BarSkeleton pos="top" />}
        bottom={<BarSkeleton pos="bottom" />}
        board={<BoardSkeleton />}
        aside={
          <div className="g-side">
            <div className="g-head">
              <span className="g-sk" style={{ height: 10, width: "50%" }} />
            </div>
            <div className="g-zone">
              <span className="g-lbl">Loading game</span>
              <span className="g-sk" style={{ height: 12, width: "70%" }} />
              <span className="g-sk" style={{ height: 12, width: "45%" }} />
            </div>
          </div>
        }
      />
    </div>
  );
}
