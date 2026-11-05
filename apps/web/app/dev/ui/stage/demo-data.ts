// Fixtures for /dev/ui/stage and the gallery layout section (SPEC 10.4, 10.5).
// Static and deterministic, so the server HTML and the hydrated page match.
import { Chess, type Square } from "chess.js";
import type { ArrowData, SquareAnnotation } from "@/app/components/ChessBoard";
import type { ShellUser } from "@/lib/shell/types";

export type StageLayout = "game" | "hub" | "list" | "empty";
export const STAGE_LAYOUTS: StageLayout[] = ["game", "hub", "list", "empty"];

/** A middlegame (Queen's Gambit Declined shape), white to move. */
export const MIDDLEGAME_FEN = "r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 9";

export const middlegameBoard = () => new Chess(MIDDLEGAME_FEN).board();
export const startBoard = () => new Chess().board();

export const LAST_MOVE: { from: Square; to: Square } = { from: "b8", to: "c6" };

export const ARROWS: ArrowData[] = [
  { from: "f3", to: "e5", color: "green" },
  { from: "c4", to: "d5", color: "orange" },
];

/** h8 is the edge-clamp case: top rank and right-most file when white is at the bottom. */
export const ANNOTATIONS: SquareAnnotation[] = [{ square: "h8", symbol: "!", icon: "best_128x.png" }];

export type DemoPlayer = { name: string; rating: string; clock: string };

export function players(stress: boolean): { top: DemoPlayer; bottom: DemoPlayer } {
  return stress
    ? {
        top: { name: "Alexandros_Papadakis", rating: "2851", clock: "15:00" },
        bottom: { name: "Maximiliana_Kowalska", rating: "1184", clock: "14:59" },
      }
    : {
        top: { name: "Paul Morphy", rating: "2690", clock: "5:00" },
        bottom: { name: "Knight Owl", rating: "1184", clock: "5:00" },
      };
}

const SAN_CYCLE = [
  "d4", "Nf6", "c4", "e6", "Nc3", "d5", "Bg5", "Be7", "e3", "O-O", "Nf3", "Nbd7",
  "Rc1", "c6", "Bd3", "dxc4", "Bxc4", "Nd5", "Bxe7", "Qxe7", "O-O", "Nxc3", "Rxc3", "e5",
  "Qc2", "exd4", "exd4", "Nf6", "Re1", "Qd6", "Ne5", "Be6", "Bxe6", "fxe6", "Qb3", "Rab8",
];

/** `count` plies as numbered rows of [white, black]. */
export function moveRows(count: number): { n: number; white: string; black: string | null }[] {
  const rows: { n: number; white: string; black: string | null }[] = [];
  for (let i = 0; i < count; i += 2) {
    rows.push({
      n: i / 2 + 1,
      white: SAN_CYCLE[i % SAN_CYCLE.length]!,
      black: i + 1 < count ? SAN_CYCLE[(i + 1) % SAN_CYCLE.length]! : null,
    });
  }
  return rows;
}

const OPENINGS = ["Queen's Gambit Declined", "Sicilian Najdorf", "Ruy Lopez", "Caro-Kann", "King's Indian", "London System"];
const LONG_OPENING = "Queen's Gambit Declined, Orthodox Defence, Rubinstein Attack, Main Line";

/** Rows for layout=list (the Mistake Bank list shape). */
export function listRows(count: number, stress: boolean): { id: string; title: string; meta: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${i + 1}`,
    title: stress ? `${LONG_OPENING} ${i + 1}` : `${OPENINGS[i % OPENINGS.length]} · Move ${12 + (i % 20)}`,
    meta: `${(i % 9) + 1} Mistakes`,
  }));
}

export function stageUser(opts: { payment: boolean; stress: boolean }): ShellUser {
  return {
    referenceId: "demo-knight-owl",
    name: opts.stress ? "Maximiliana_Kowalska" : "Knight Owl",
    avatarUrl: null,
    isAdmin: false,
    ratingLabel: "Blitz 1184",
    trialDaysLeft: null,
    paymentFailed: opts.payment,
    paymentFailedUntil: opts.payment ? "2026-11-12T00:00:00.000Z" : null,
    paymentFailedUntilLabel: opts.payment ? "Nov 12" : null,
    hasBillingPortal: true,
  };
}
