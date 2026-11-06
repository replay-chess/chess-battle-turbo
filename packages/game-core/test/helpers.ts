// Test drivers shared by the machine, client and transcript suites.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createGame, projectState, type CreateGameInput } from "../src/machine/create";
import { reduce } from "../src/machine/reduce";
import {
  DEFAULT_MACHINE_CONFIG,
  type Effect,
  type MachineConfig,
  type MachineInput,
  type ReduceResult,
  type RoomEvent,
  type ServerGame,
} from "../src/machine/state";
import type { Side } from "../src/machine/types";
import { fenAfter } from "../src/rules/chess";
import { INITIAL_FEN } from "../src/constants";

const require = createRequire(import.meta.url);

type DesignLine = { startFen: string; san: string[]; uci: string[]; gameStartsAtPly: number };
export const DESIGN = JSON.parse(readFileSync(require.resolve("@repo/chess-fixtures/design/V3Game.json"), "utf8")) as {
  lines: Record<string, DesignLine>;
  states: Record<string, { line: string; ply: number }>;
};
/** The Opera Game line (design L.MAIN), 33 plies to 17.Rd8#. */
export const MAIN = DESIGN.lines.MAIN!;
/** The legend start: the position after 9…b5 (ply 18), White to move. */
export const LEGEND_FEN = fenAfter(MAIN.startFen, MAIN.uci.slice(0, MAIN.gameStartsAtPly));
/** The moves played in a legend-start game (10.Nxb5 … 17.Rd8#). */
export const LEGEND_MOVES = MAIN.uci.slice(MAIN.gameStartsAtPly);

export const T0 = 1_700_000_000_000;

export function gameInput(over: Partial<CreateGameInput> = {}): CreateGameInput {
  return {
    ref: "cgame0000000000000000000001",
    mode: "FRIEND",
    tc: { initialMs: 300_000, incrementMs: 3_000 },
    startFen: INITIAL_FEN,
    studySeconds: 0,
    seats: {
      w: { ref: "cuserwhite0000000000000001", name: "knightowl_88", avatarUrl: null, rating: 1184 },
      b: { ref: "cuserblack0000000000000001", name: "martin_k", avatarUrl: null, rating: 1212 },
    },
    ...over,
  };
}

export class Live {
  s: ServerGame;
  now: number;
  events: RoomEvent[] = [];
  effects: Effect[] = [];
  last!: ReduceResult;
  private n = 0;

  constructor(
    over: Partial<CreateGameInput> = {},
    readonly config: MachineConfig = DEFAULT_MACHINE_CONFIG,
    now = T0,
  ) {
    this.now = now;
    this.s = createGame(gameInput(over), now);
  }

  do(input: MachineInput, advanceMs = 0): ReduceResult {
    this.now += advanceMs;
    this.last = reduce(this.s, input, this.now, this.config);
    this.s = this.last.state;
    this.events.push(...this.last.events);
    this.effects.push(...this.last.effects);
    return this.last;
  }

  /** Both players connect (one socket each). */
  join(): this {
    this.do({ type: "attach", side: "w", socketId: "w1" });
    this.do({ type: "attach", side: "b", socketId: "b1" });
    return this;
  }

  move(side: Side, uci: string, advanceMs = 0, extra: { premove?: boolean; clientMoveId?: string } = {}): ReduceResult {
    return this.do(
      {
        type: "move",
        side,
        ply: this.s.startPly + this.s.moves.length,
        uci,
        clientMoveId: extra.clientMoveId ?? `m${++this.n}`,
        premove: extra.premove ?? false,
      },
      advanceMs,
    );
  }

  /** Plays both first moves so the game is in `playing`. */
  firstMoves(a: string, b: string): this {
    this.move(this.s.turn, a, 1_000);
    this.move(this.s.turn, b, 1_000);
    return this;
  }

  names(room: "game" | "spectate" = "game"): string[] {
    return this.events.filter((e) => e.room === room).map((e) => e.event.name);
  }

  lastNames(room: "game" | "spectate" = "game"): string[] {
    return this.last.events.filter((e) => e.room === room).map((e) => e.event.name);
  }

  view(side?: Side) {
    return projectState(this.s, side ? { role: "player", color: side } : { role: "spectator" }, this.now);
  }

  effectTypes(): string[] {
    return this.last.effects.map((e) => e.type);
  }
}
