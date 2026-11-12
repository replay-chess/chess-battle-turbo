// /practice — Practice from a position (phase-03 plan §4.8, §5.9). Three entry forms, exactly one per URL:
//   ?game=<ref>&ply=<n>   a finished game of yours at the position before ply n (the game-over Replay, Compare)
//   ?position=<ref>       a legend position (chess_positions)
//   ?fen=<urlencoded>     any legal position (validated on the server: one king each, the side not to move not in
//                         check, no pawn on the first or last rank)
// A server component: the gate, then one read through the DAL (`getPracticeContext`; read only, nothing enqueued, no
// writes), then the client screen. A game you did not play and an unknown game or position are the same 404; an
// illegal FEN is the "This position isn't legal" page.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PracticeQuery, practiceTargetOf, type PracticeContextDTO } from "@repo/contracts/http/practice";
import { IllegalPosition } from "@/features/practice/IllegalPosition";
import { PracticeScreen } from "@/features/practice/PracticeScreen";
import { ApiError } from "@/lib/api/api-error";
import { getPracticeContext, isNotFound } from "@/lib/data/practice";
import { practiceGate } from "./gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Practice", robots: { index: false, follow: false } };

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const SOURCE_KEYS = ["game", "ply", "position", "fen"] as const;

export default async function PracticePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // The layout ran the gate; soft navigations skip layouts, so the page repeats it (the same cached reads).
  const viewer = await practiceGate();

  const raw: Partial<Record<(typeof SOURCE_KEYS)[number], string>> = {};
  for (const k of SOURCE_KEYS) {
    const v = one(sp[k]);
    if (v !== undefined) raw[k] = v;
  }
  const parsed = PracticeQuery.safeParse(raw);
  if (!parsed.success) {
    if (raw.fen !== undefined && raw.game === undefined && raw.position === undefined) return <IllegalPosition />;
    notFound();
  }

  let context: PracticeContextDTO;
  try {
    context = await getPracticeContext(viewer, practiceTargetOf(parsed.data));
  } catch (err) {
    if (isNotFound(err)) notFound();
    if (err instanceof ApiError && err.code === "validation_failed") {
      if (err.details?.reason === "illegal_position") return <IllegalPosition />;
      notFound();
    }
    throw err;
  }

  // The session-resume key: the position's own parameters (never `from`, which only says where the link was).
  const urlKey = `/practice?${new URLSearchParams(raw as Record<string, string>).toString()}`;
  return (
    <PracticeScreen
      context={context}
      viewer={{ name: viewer.user.name, ratingLabel: viewer.user.ratingLabel }}
      urlKey={urlKey}
      from={one(sp.from) ?? null}
    />
  );
}
