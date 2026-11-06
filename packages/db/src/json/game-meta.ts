// JSON column registry entry for `games.meta` (phase-02 plan 6.2, data-model §2.6).
//
// Written at creation (header, prefix, position card are computed once from chess_positions/openings, so neither
// the socket session nor the RSC snapshot joins those tables), then patched by the live writers (assists, rev,
// drawOffers, premoves, abortedBy). Readers use `parseGameMeta`, which never throws: a legacy or malformed value
// reads as `null` and the caller falls back to defaults.
import { z } from "zod";

const Side = z.enum(["w", "b"]);

export const GameMetaPosition = z.object({
  name: z.string().max(80),
  event: z.string().max(80).nullable(),
  year: z.number().int().nullable(),
  afterLabel: z.string().max(16).nullable(),
  legendSide: Side.nullable(),
});
export type GameMetaPosition = z.infer<typeof GameMetaPosition>;

export const GameMetaV1 = z.object({
  v: z.literal(1),
  /** Left header: "C41 · Philidor · Opera Game 1858" | "Endgame · move 41" | "" */
  header: z.string().max(80),
  /** Legend/opening moves before startingFen ("Game starts here"). The last ≤ 120 SAN. */
  prefixSan: z.array(z.string().max(8)).max(120),
  prefixStartMoveNo: z.number().int().min(1),
  position: GameMetaPosition.nullable(),
  /** Bot games: monotonic journal revision (undo-safe checkpoints). */
  rev: z.number().int().min(0).default(0),
  assists: z.object({ hints: z.number().int().min(0), undos: z.number().int().min(0) }).default({ hints: 0, undos: 0 }),
  drawOffers: z.object({ w: z.number().int(), b: z.number().int() }).default({ w: 0, b: 0 }),
  premoves: z.object({ w: z.number().int(), b: z.number().int() }).default({ w: 0, b: 0 }),
  abortedBy: z.enum(["w", "b", "timeout", "stale"]).nullable().default(null),
  client: z.object({ build: z.string().max(40) }).optional(),
});
/** Parsed shape (defaults applied). */
export type GameMetaV1 = z.output<typeof GameMetaV1>;
/** Input shape (defaulted fields optional). */
export type GameMetaV1Input = z.input<typeof GameMetaV1>;

export type AbortedBy = NonNullable<GameMetaV1["abortedBy"]>;

/** The meta of a game with no header, prefix or position (initial position, no legend). */
export function emptyGameMeta(): GameMetaV1 {
  return GameMetaV1.parse({ v: 1, header: "", prefixSan: [], prefixStartMoveNo: 1, position: null });
}

/** Validates and fills defaults; throws a ZodError on a bad value (writers only). */
export function buildGameMeta(input: GameMetaV1Input): GameMetaV1 {
  return GameMetaV1.parse(input);
}

/** Tolerant reader: `null` for a missing, legacy or malformed value. Never throws. */
export function parseGameMeta(value: unknown): GameMetaV1 | null {
  const parsed = GameMetaV1.safeParse(value);
  return parsed.success ? parsed.data : null;
}
