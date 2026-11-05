import { z } from "zod";

/** A cuid reference (`referenceId` columns). */
export const Ref = z.string().regex(/^c[a-z0-9]{20,31}$/);
export type Ref = z.infer<typeof Ref>;

/** An ISO-8601 UTC instant with `Z` (API §2.2). */
export const IsoDateTime = z.iso.datetime();
export type IsoDateTime = z.infer<typeof IsoDateTime>;

/** Page size query parameter: coerced from the query string, `def` when absent, 1…`max`. */
export const Limit = (def = 20, max = 50) => z.coerce.number().int().min(1).max(max).default(def);

/** Opaque keyset cursor as it arrives in a query string (see cursor.ts). */
export const CursorParam = z
  .string()
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/)
  .optional();

/** A move in UCI notation (`e2e4`, `e7e8q`). */
export const Uci = z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
export type Uci = z.infer<typeof Uci>;

export const Color = z.enum(["w", "b"]);
export type Color = z.infer<typeof Color>;

/**
 * A cheap FEN shape check that is safe for client bundles (no chess.js). It checks the field layout only, not
 * legality; servers that need legality use the strict `Fen` P2 adds. The move counters are optional.
 */
export const FenLoose = z
  .string()
  .max(100)
  .regex(/^(?:[prnbqkPRNBQK1-8]{1,8}\/){7}[prnbqkPRNBQK1-8]{1,8} [wb] (?:-|[KQkq]{1,4}) (?:-|[a-h][36])(?: \d{1,3} \d{1,4})?$/);
export type FenLoose = z.infer<typeof FenLoose>;
