// JSON column registry entry for shares.snapshot (phase-03 plan 6.6, 11.3; data-model §2.6, D17).
//
// The frozen public payload of a REVIEW share (/r/<code>): A10 builds it once from the review with the §11.3
// masking applied (names hidden when showUsername is false), and A11 rewrites only the names. The public page and
// the image route read nothing else from the database. POSITION shares (P9) add their own version.
import { z } from "zod";

/** shares.kind (the ShareKind enum). P3 writes REVIEW only. */
export const ShareKind = z.enum(["POSITION", "REVIEW"]);
export type ShareKind = z.infer<typeof ShareKind>;

/** 8 chars of Crockford base32, lowercase (no i, l, o, u): 40 random bits. */
export const SHARE_CODE_RE = /^[0-9abcdefghjkmnpqrstvwxyz]{8}$/;
export const ShareCode = z.string().regex(SHARE_CODE_RE);

const SnapshotPlayer = z.object({ name: z.string().max(40), rating: z.number().int().nullable(), isYou: z.boolean() });

export const ShareSnapshotV1 = z.object({
  v: z.literal(1),
  kind: z.literal("review"),
  players: z.object({ w: SnapshotPlayer, b: SnapshotPlayer }),
  /** "1-0" | "0-1" | "½-½" label as shown */
  result: z.string().max(16),
  endLabel: z.string().max(40),
  tcLabel: z.string().max(24),
  /** date only (yyyy-mm-dd), never a time */
  playedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startFen: z.string().max(100),
  /** space-separated UCI from startFen */
  moves: z.string(),
  /** space-separated SAN */
  san: z.string(),
  /** judgement codes, one char per ply (CA/src/codec.ts) */
  j: z.string(),
  /** White-POV evals per position (the game_analyses.evals encoding) */
  evals: z.array(z.number().int()),
  accuracy: z.object({ you: z.number().nullable(), opp: z.number().nullable() }),
  moment: z
    .object({
      ply: z.number().int().min(0),
      playedSan: z.string().max(10),
      bestSan: z.string().max(10),
      judgement: z.number().int().min(1).max(12),
      caption: z.string().max(200),
      arrow: z.tuple([z.string().regex(/^[a-h][1-8]$/), z.string().regex(/^[a-h][1-8]$/)]),
    })
    .nullable(),
  summary: z.array(z.string().max(400)).max(4),
  gradingVersion: z.number().int().min(1),
});
export type ShareSnapshotV1 = z.infer<typeof ShareSnapshotV1>;

/** Validates a snapshot; throws a ZodError on a bad value (A10/A11 before the write). */
export function buildShareSnapshot(input: ShareSnapshotV1): ShareSnapshotV1 {
  return ShareSnapshotV1.parse(input);
}

/** Tolerant reader: `null` for a missing, legacy or malformed value (the page shows the generic card). Never throws. */
export function parseShareSnapshot(value: unknown): ShareSnapshotV1 | null {
  const parsed = ShareSnapshotV1.safeParse(value);
  return parsed.success ? parsed.data : null;
}
