import type { Metadata } from "next";
import { GalleryFrame } from "../_components/Specimen";
import { BoardDemo } from "./BoardDemo";
import { BOARD_PRESETS, type BoardPreset } from "./presets";

export const metadata: Metadata = { title: "UI Gallery · Board", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * `/dev/ui/board` (P2 plan §13.1 row F): the V3MoveBoard input contract (§4.5.3)
 * without a game server. Fails closed outside dev/test (app/dev/layout.tsx).
 * Params: preset=start|promotion|check|castle|enpassant|premove|study|badges|arrows,
 * orient=w|b, fen=<FEN> (overrides the preset position), botDelay=<ms> (premove
 * preset; default 1200, 0 = wait for the "Black Moves" button), anim=0 (snap, no slides).
 */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const p = await searchParams;
  const presetParam = one(p.preset);
  const preset: BoardPreset = BOARD_PRESETS.includes(presetParam as BoardPreset) ? (presetParam as BoardPreset) : "start";
  const orient = one(p.orient) === "b" ? "b" : "w";
  const botDelay = Number.parseInt(one(p.botDelay) ?? "1200", 10);
  return (
    <GalleryFrame title="UI Gallery · Board">
      <BoardDemo
        key={`${preset}-${orient}-${one(p.fen) ?? ""}`}
        preset={preset}
        orient={orient}
        fen={one(p.fen)}
        botDelay={Number.isFinite(botDelay) && botDelay >= 0 ? botDelay : 0}
        animate={one(p.anim) !== "0"}
      />
    </GalleryFrame>
  );
}
