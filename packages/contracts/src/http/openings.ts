// Temporary: P8 deletes this file when the catalogue moves to /api/catalog/openings?v= (CC R-15).
import { z } from "zod";
import { Ref } from "./common";

export const OpeningIndexEntry = z.object({ id: Ref, eco: z.string().max(3), name: z.string().max(200) });
export type OpeningIndexEntry = z.infer<typeof OpeningIndexEntry>;

/** GET /api/openings (≈ 3,641 rows). */
export const OpeningsIndexData = z.object({ openings: z.array(OpeningIndexEntry) });
export type OpeningsIndexData = z.infer<typeof OpeningsIndexData>;
